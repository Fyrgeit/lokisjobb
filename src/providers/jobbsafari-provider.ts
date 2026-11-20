import { load } from 'cheerio';
import type { ScrapedJob } from '../types/job.js';
import {
    cleanProviderText,
    warnProviderDetailFailure,
    type JobProvider,
} from './job-provider.js';
import {
    availabilityFromResponse,
    fetchProviderHtml,
    providerFetchHeaders,
} from './availability.js';

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
        ? cleanProviderText(value)
        : cleanProviderText(value?.text);
}

function toJob(result: JobbsafariResult, sourceUrl: string): ScrapedJob | null {
    if (!result.title || !result.slug) {
        return null;
    }

    const listingUrl = new URL(
        `/lediga-jobb/${result.slug}`,
        sourceUrl,
    ).toString();
    return {
        title: result.title,
        company: cleanProviderText(result.company?.name),
        location: cleanProviderText(result.locations?.[0]?.name),
        listingUrl,
        description: getDescription(result.description),
        applicationDeadline: formatDeadline(result.endDate),
        ...(result.apply?.href
            ? {
                  applicationUrl: new URL(
                      result.apply.href,
                      listingUrl,
                  ).toString(),
              }
            : {}),
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
        company:
            cleanProviderText(detail.company?.name) ?? existingJob.company,
        location:
            cleanProviderText(detail.locations?.[0]?.name) ??
            existingJob.location,
        description:
            getDescription(detail.description) ?? existingJob.description,
        applicationDeadline:
            formatDeadline(detail.endDate) ?? existingJob.applicationDeadline,
        ...(detail.apply?.href
            ? {
                  applicationUrl: new URL(
                      detail.apply.href,
                      existingJob.listingUrl,
                  ).toString(),
              }
            : {}),
    };
}

export class JobbsafariProvider implements JobProvider {
    public readonly name = 'jobbsafari.se';

    public constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    public async search(query: string): Promise<ScrapedJob[]> {
        const url = new URL(jobbsafariSearchUrl);
        url.searchParams.set('sok', query);

        const html = await fetchProviderHtml(
            this.fetchImpl,
            url,
            'Jobbsafari',
        );
        const jobs = parseJobbsafariJobs(html, url.toString());

        // Search results contain summary data; detail pages provide the full
        // description and can also correct summary metadata.
        for (const job of jobs) {
            try {
                // The apply URL may be mailto: or an external ATS link. The
                // Jobbsafari detail page is always the listingUrl.
                const detailResponse = await this.fetchImpl(job.listingUrl, {
                    headers: providerFetchHeaders(),
                });

                if (detailResponse.ok) {
                    Object.assign(
                        job,
                        parseJobbsafariDetail(await detailResponse.text(), job),
                    );
                    job.availability = 'active';
                } else {
                    job.availability = availabilityFromResponse(
                        detailResponse.status,
                    );
                }
            } catch (error: unknown) {
                warnProviderDetailFailure(
                    'Jobbsafari',
                    job.listingUrl,
                    error,
                );
            }
        }

        return jobs;
    }
}
