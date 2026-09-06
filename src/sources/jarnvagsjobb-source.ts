import { load } from 'cheerio';
import type { ScrapedJob } from '../types/job.js';
import type { JobSource } from './job-source.js';

export const jarnvagsjobbListingUrl =
    'https://jarnvagsjobb.se/jobba-inom-jarnvagen/lediga-jobb-inom-jarnvagsbranschen/';

// Site HTML contains a lot of layout and WordPress-generated whitespace. A
// single cleanup function keeps the normalized values predictable.
function cleanText(value: string | undefined): string | null {
    const text = value?.replace(/\s+/g, ' ').trim();
    return text || null;
}

export function parseJarnvagsjobbDescription(html: string): string | null {
    const $ = load(html);
    const content = $('article .entry-content').first().clone();

    // The detail page keeps the actual vacancy text beside its title and
    // metadata. Remove those pieces so description contains only the body.
    content
        .find('h1, .single__meta, script, style, .screen-reader-text')
        .remove();

    return cleanText(content.text());
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
        const title = cleanText(titleLink.text());
        const href = titleLink.attr('href');

        if (!title || !href) {
            return;
        }

        jobs.push({
            title,
            company: cleanText(row.find('td.list-column.company').text()),
            location: cleanText(row.find('td.list-column.city').text()),
            url: new URL(href, sourceUrl).toString(),
            description: null,
            applicationDeadline: cleanText(
                row.find('td.list-column.apply_by').text(),
            ),
        });
    });

    return jobs;
}

export class JarnvagsjobbSource implements JobSource {
    public readonly name = 'jarnvagsjobb.se';

    public constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    public async search(query: string): Promise<ScrapedJob[]> {
        // The search term is encoded by URLSearchParams, so Swedish characters
        // and spaces are sent safely to the website.
        const url = new URL(jarnvagsjobbListingUrl);
        url.searchParams.set('search', query);

        const response = await this.fetchImpl(url, {
            headers: {
                Accept: 'text/html',
                'User-Agent': 'Lokisjobb/0.1 (local personal job search)',
            },
        });

        if (!response.ok) {
            throw new Error(
                `Järnvägsjobb request failed with HTTP ${response.status}`,
            );
        }

        const jobs = parseJarnvagsjobbJobs(
            await response.text(),
            url.toString(),
        );

        // The listing page has only summaries. Fetch detail pages one at a time
        // so the scraper stays simple and does not create a burst of requests.
        for (const job of jobs) {
            try {
                const detailResponse = await this.fetchImpl(job.url, {
                    headers: {
                        Accept: 'text/html',
                        'User-Agent':
                            'Lokisjobb/0.1 (local personal job search)',
                    },
                });

                if (!detailResponse.ok) {
                    continue;
                }

                job.description = parseJarnvagsjobbDescription(
                    await detailResponse.text(),
                );
            } catch (error: unknown) {
                const message =
                    error instanceof Error ? error.message : String(error);
                console.warn(
                    `Could not fetch job details from ${job.url}: ${message}`,
                );
            }
        }

        return jobs;
    }
}
