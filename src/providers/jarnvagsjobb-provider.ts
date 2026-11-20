import { load } from 'cheerio';
import type { ScrapedJob } from '../types/job.js';
import {
    cleanProviderText,
    warnProviderDetailFailure,
    type JobProvider,
} from './job-provider.js';
import {
    availabilityFromResponse,
    checkApplicationAvailability,
    fetchProviderHtml,
    providerFetchHeaders,
} from './availability.js';

export const jarnvagsjobbListingUrl =
    'https://jarnvagsjobb.se/jobba-inom-jarnvagen/lediga-jobb-inom-jarnvagsbranschen/';

export function parseJarnvagsjobbDescription(html: string): string | null {
    const $ = load(html);
    const content = $('article .entry-content').first().clone();

    // The detail page keeps the actual vacancy text beside its title and
    // metadata. Remove those pieces so description contains only the body.
    content
        .find('h1, .single__meta, script, style, .screen-reader-text')
        .remove();

    return cleanProviderText(content.text());
}

export function parseJarnvagsjobbJobs(
    html: string,
    sourceUrl = jarnvagsjobbListingUrl,
): ScrapedJob[] {
    const $ = load(html);
    const jobs: ScrapedJob[] = [];

    // These selectors are specific to the site's listing table. Website
    // changes should therefore be isolated to this parser.
    $('table tbody tr').each((_index, element) => {
        const row = $(element);
        const titleLink = row.find('td.list-column.title a.row-link').first();
        const title = cleanProviderText(titleLink.text());
        const href = titleLink.attr('href');

        if (!title || !href) {
            return;
        }

        jobs.push({
            title,
            company: cleanProviderText(row.find('td.list-column.company').text()),
            location: cleanProviderText(row.find('td.list-column.city').text()),
            listingUrl: new URL(href, sourceUrl).toString(),
            description: null,
            applicationDeadline: cleanProviderText(
                row.find('td.list-column.apply_by').text(),
            ),
        });
    });

    return jobs;
}

export class JarnvagsjobbProvider implements JobProvider {
    public readonly name = 'jarnvagsjobb.se';

    public constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    public async search(query: string): Promise<ScrapedJob[]> {
        // The search term is encoded by URLSearchParams, so Swedish characters
        // and spaces are sent safely to the website.
        const url = new URL(jarnvagsjobbListingUrl);
        url.searchParams.set('search', query);

        const html = await fetchProviderHtml(
            this.fetchImpl,
            url,
            'Järnvägsjobb',
        );
        const jobs = parseJarnvagsjobbJobs(html, url.toString());

        // The listing page has only summaries. Fetch detail pages one at a time
        // so the scraper stays simple and does not create a burst of requests.
        for (const job of jobs) {
            try {
                const detailResponse = await this.fetchImpl(job.listingUrl, {
                    headers: providerFetchHeaders(),
                });

                if (!detailResponse.ok) {
                    job.availability = availabilityFromResponse(
                        detailResponse.status,
                    );
                    continue;
                }

                const detailHtml = await detailResponse.text();
                job.description = parseJarnvagsjobbDescription(detailHtml);
                const detailPage = load(detailHtml);
                const applyUrl = detailPage(
                    '.single__vacancy-meta__cta a.button',
                ).attr('href');
                if (applyUrl) {
                    job.applicationUrl = new URL(
                        applyUrl,
                        job.listingUrl,
                    ).toString();
                    job.availability = await checkApplicationAvailability(
                        this.fetchImpl,
                        job.applicationUrl,
                    );
                } else {
                    job.availability = 'active';
                }
            } catch (error: unknown) {
                warnProviderDetailFailure(
                    'Järnvägsjobb',
                    job.listingUrl,
                    error,
                );
            }
        }

        return jobs;
    }
}
