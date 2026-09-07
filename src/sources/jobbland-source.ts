import { load } from 'cheerio';
import type { ScrapedJob } from '../types/job.js';
import type { JobSource } from './job-source.js';
import {
    availabilityFromResponse,
    checkApplicationAvailability,
} from './availability.js';

export const jobblandSearchUrl =
    'https://jobbland.se/lediga-jobb/yrke/lokforare';

function cleanText(value: string | undefined): string | null {
    const text = value?.replace(/\s+/g, ' ').trim();
    return text || null;
}

function parseDeadline(text: string): string | null {
    const match = text.match(/Slutdatum\s+(\d{4}-\d{2}-\d{2})/i);
    return match?.[1] ?? null;
}

export function parseJobblandJobs(
    html: string,
    sourceUrl = jobblandSearchUrl,
): ScrapedJob[] {
    const $ = load(html);
    const jobs: ScrapedJob[] = [];

    // Primary results use this wrapper. It keeps recommended cards out of the
    // search result set and isolates the site's markup in this source.
    // Jobbland appends recommended cards after the primary result cards in the
    // same container. The first six are the result set for this profession page.
    $('.search-results-box .job-card-wrapper')
        .slice(0, 6)
        .each((_index, element) => {
            const card = $(element);
            const link = card.find('a.job-card').first();
            if (!link.attr('data-position')) {
                return;
            }

            const title = cleanText(link.attr('title') ?? link.text());
            const href = link.attr('href');

            if (!title || !href) {
                return;
            }

            const cardText = cleanText(card.text()) ?? '';
            const company = cleanText(link.attr('data-company'));
            const textAfterCompany = company
                ? (cardText.split(company).pop() ?? cardText)
                : cardText;
            const location = textAfterCompany.match(
                /\s([^·]+?)\s·\sAnsökningsperiod/i,
            )?.[1];

            jobs.push({
                title,
                company,
                location: cleanText(location),
                url: new URL(href, sourceUrl).toString(),
                sourceUrl: new URL(href, sourceUrl).toString(),
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
            (_index, element) => cleanText($(element).text()) === 'Om jobbet',
        )
        .first();

    if (!heading.length) {
        return null;
    }

    return cleanText(heading.parent().text()?.replace(heading.text(), ''));
}

export class JobblandSource implements JobSource {
    public readonly name = 'jobbland.se';

    public constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    public async search(query: string): Promise<ScrapedJob[]> {
        const url = new URL(jobblandSearchUrl);
        if (query !== 'lokförare') {
            url.searchParams.set('search', query);
        }

        const response = await this.fetchImpl(url, {
            headers: {
                Accept: 'text/html',
                'User-Agent': 'Lokisjobb/0.1 (local personal job search)',
            },
        });

        if (!response.ok) {
            throw new Error(
                `Jobbland request failed with HTTP ${response.status}`,
            );
        }

        const jobs = parseJobblandJobs(await response.text(), url.toString());

        // Search cards are summaries. Detail pages contain the full description
        // and the authoritative deadline.
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
                    job.availability = availabilityFromResponse(
                        detailResponse.status,
                    );
                    continue;
                }

                const detailHtml = await detailResponse.text();
                const detailPage = load(detailHtml);
                job.description = parseJobblandDescription(detailHtml);
                const applyUrl = detailPage('a.apply--button')
                    .first()
                    .attr('href');
                if (applyUrl) {
                    job.url = new URL(applyUrl, job.sourceUrl).toString();
                    job.availability = await checkApplicationAvailability(
                        this.fetchImpl,
                        job.url,
                    );
                } else {
                    job.availability = 'active';
                }
                job.applicationDeadline = parseDeadline(
                    cleanText(detailPage('body').text()) ?? '',
                );
            } catch (error: unknown) {
                const message =
                    error instanceof Error ? error.message : String(error);
                console.warn(
                    `Could not fetch Jobbland details from ${job.url}: ${message}`,
                );
            }
        }

        return jobs;
    }
}
