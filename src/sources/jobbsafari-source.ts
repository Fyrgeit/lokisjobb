import { load } from 'cheerio';
import type { ScrapedJob } from '../types/job.js';
import type { JobSource } from './job-source.js';

export const jobbsafariSearchUrl = 'https://jobbsafari.se/lediga-jobb';

type JobbsafariResult = {
    title?: string;
    slug?: string;
    endDate?: string;
    company?: { name?: string };
    locations?: Array<{ name?: string }>;
    description?: string | { text?: string };
    apply?: { href?: string };
};

type JobbsafariPageData = {
    props?: {
        pageProps?: {
            jobEntries?: { results?: JobbsafariResult[] };
            jobEntry?: JobbsafariResult;
            job?: JobbsafariResult;
        };
    };
};

function cleanText(value: string | undefined): string | null {
    const text = value?.replace(/\s+/g, ' ').trim();
    return text || null;
}

function extractPageData(html: string): JobbsafariPageData | null {
    const $ = load(html);
    const json = $('script#__NEXT_DATA__').first().text();

    if (!json) {
        return null;
    }

    try {
        return JSON.parse(json) as JobbsafariPageData;
    } catch {
        return null;
    }
}

function formatDeadline(value: string | undefined): string | null {
    if (!value) {
        return null;
    }

    const date = value.slice(0, 10);
    // Jobbsafari uses a far-future placeholder instead of "no deadline".
    return date.startsWith('2650-') ? null : date;
}

function getDescription(value: JobbsafariResult['description']): string | null {
    return typeof value === 'string'
        ? cleanText(value)
        : cleanText(value?.text);
}

function toJob(result: JobbsafariResult, sourceUrl: string): ScrapedJob | null {
    if (!result.title || !result.slug) {
        return null;
    }

    return {
        title: result.title,
        company: cleanText(result.company?.name),
        location: cleanText(result.locations?.[0]?.name),
        url: new URL(`/lediga-jobb/${result.slug}`, sourceUrl).toString(),
        sourceUrl: new URL(`/lediga-jobb/${result.slug}`, sourceUrl).toString(),
        description: getDescription(result.description),
        applicationDeadline: formatDeadline(result.endDate),
        ...(result.apply?.href ? { url: result.apply.href } : {}),
    };
}

export function parseJobbsafariJobs(
    html: string,
    sourceUrl = jobbsafariSearchUrl,
): ScrapedJob[] {
    const data = extractPageData(html);
    const results = data?.props?.pageProps?.jobEntries?.results ?? [];

    return results
        .map((result) => toJob(result, sourceUrl))
        .filter((job): job is ScrapedJob => job !== null);
}

function parseJobbsafariDetail(
    html: string,
    existingJob: ScrapedJob,
): ScrapedJob {
    const data = extractPageData(html);
    const pageProps = data?.props?.pageProps;
    const detail = pageProps?.jobEntry ?? pageProps?.job;

    if (!detail) {
        return existingJob;
    }

    return {
        ...existingJob,
        title: detail.title ?? existingJob.title,
        company: cleanText(detail.company?.name) ?? existingJob.company,
        location:
            cleanText(detail.locations?.[0]?.name) ?? existingJob.location,
        description:
            getDescription(detail.description) ?? existingJob.description,
        applicationDeadline:
            formatDeadline(detail.endDate) ?? existingJob.applicationDeadline,
        ...(detail.apply?.href ? { url: detail.apply.href } : {}),
    };
}

export class JobbsafariSource implements JobSource {
    public readonly name = 'jobbsafari.se';

    public constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    public async search(query: string): Promise<ScrapedJob[]> {
        const url = new URL(jobbsafariSearchUrl);
        url.searchParams.set('sok', query);

        const response = await this.fetchImpl(url, {
            headers: {
                Accept: 'text/html',
                'User-Agent': 'Lokisjobb/0.1 (local personal job search)',
            },
        });

        if (!response.ok) {
            throw new Error(
                `Jobbsafari request failed with HTTP ${response.status}`,
            );
        }

        const jobs = parseJobbsafariJobs(await response.text(), url.toString());

        // Search results contain summary data; detail pages provide the full
        // description and can also correct summary metadata.
        for (const job of jobs) {
            try {
                // The apply URL may be mailto: or an external ATS link. The
                // Jobbsafari detail page is always the sourceUrl.
                const detailResponse = await this.fetchImpl(job.sourceUrl, {
                    headers: {
                        Accept: 'text/html',
                        'User-Agent':
                            'Lokisjobb/0.1 (local personal job search)',
                    },
                });

                if (detailResponse.ok) {
                    Object.assign(
                        job,
                        parseJobbsafariDetail(await detailResponse.text(), job),
                    );
                }
            } catch (error: unknown) {
                const message =
                    error instanceof Error ? error.message : String(error);
                console.warn(
                    `Could not fetch Jobbsafari details from ${job.url}: ${message}`,
                );
            }
        }

        return jobs;
    }
}
