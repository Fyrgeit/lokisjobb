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

export const jobblandSearchBaseUrl = 'https://jobbland.se/lediga-jobb';

function parseDeadline(text: string): string | null {
    const match = text.match(/Slutdatum\s+(\d{4}-\d{2}-\d{2})/i);
    return match?.[1] ?? null;
}

export function parseJobblandJobs(
    html: string,
    sourceUrl = jobblandSearchBaseUrl,
): ScrapedJob[] {
    const $ = load(html);
    const jobs: ScrapedJob[] = [];

    // Primary results use this wrapper. It keeps recommended cards out of the
    // search result set and isolates the site's markup in this source.
    // Jobbland appends recommended cards after the primary result cards in the
    // same container. The first six are the result set for this search.
    $('.search-results-box .job-card-wrapper')
        .slice(0, 10)
        .each((_index, element) => {
            const card = $(element);
            const link = card.find('a.job-card').first();
            if (!link.attr('data-position')) {
                return;
            }

            const title = cleanProviderText(link.attr('title') ?? link.text());
            const href = link.attr('href');

            if (!title || !href) {
                return;
            }

            const cardText = cleanProviderText(card.text()) ?? '';
            const company = cleanProviderText(link.attr('data-company'));
            const textAfterCompany = company
                ? (cardText.split(company).pop() ?? cardText)
                : cardText;
            const location = textAfterCompany.match(
                /\s([^·]+?)\s·\sAnsökningsperiod/i,
            )?.[1];

            jobs.push({
                title,
                company,
                location: cleanProviderText(location),
                listingUrl: new URL(href, sourceUrl).toString(),
                description: null,
                applicationDeadline: null,
            });
        });

    return jobs;
}

export function parseJobblandDescription(html: string): string | null {
    const $ = load(html);
    const heading = $('h2')
        .filter(
            (_index, element) =>
                cleanProviderText($(element).text()) === 'Om jobbet',
        )
        .first();

    if (!heading.length) {
        return null;
    }

    return cleanProviderText(
        heading.parent().text()?.replace(heading.text(), ''),
    );
}

export class JobblandProvider implements JobProvider {
    public readonly name = 'jobbland.se';

    public constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    public async search(query: string): Promise<ScrapedJob[]> {
        const url = new URL(jobblandSearchBaseUrl);
        const formattedQuery = query.replace(/,\s*/g, ';');
        url.searchParams.set('title', formattedQuery);

        const html = await fetchProviderHtml(
            this.fetchImpl,
            url,
            'Jobbland',
        );
        const jobs = parseJobblandJobs(html, url.toString());

        // Search cards are summaries. Detail pages contain the full description
        // and the authoritative deadline.
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

                const html = await detailResponse.text();
                const description = parseJobblandDescription(html);
                const deadline = parseDeadline(html);

                if (description) {
                    job.description = description;
                }
                if (deadline) {
                    job.applicationDeadline = deadline;
                }

                job.availability = await checkApplicationAvailability(
                    this.fetchImpl,
                    job.listingUrl,
                );
            } catch (error: unknown) {
                warnProviderDetailFailure(
                    'Jobbland',
                    job.listingUrl,
                    error,
                );
            }
        }

        return jobs;
    }
}
