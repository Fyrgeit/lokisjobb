import type { ScrapedJob } from '../types/job.js';
import type { JobSource } from './job-source.js';

export const arbetsformedlingenSearchUrl =
    'https://jobsearch.api.jobtechdev.se/search';

type JobSearchHit = {
    headline?: string;
    webpage_url?: string;
    description?: { text?: string };
    application_deadline?: string;
    application_details?: { url?: string };
    employer?: { name?: string };
    workplace_address?: { municipality?: string; city?: string };
    removed?: boolean;
};

type JobSearchResponse = {
    hits?: JobSearchHit[];
};

function cleanText(value: string | undefined): string | null {
    const text = value?.replace(/\s+/g, ' ').trim();
    return text || null;
}

function formatDeadline(value: string | undefined): string | null {
    // The API returns an ISO timestamp; the application only needs the date.
    return value ? value.slice(0, 10) : null;
}

export function mapArbetsformedlingenHit(hit: JobSearchHit): ScrapedJob | null {
    if (!hit.headline || !hit.webpage_url) {
        return null;
    }

    return {
        title: hit.headline,
        company: cleanText(hit.employer?.name),
        location: cleanText(
            hit.workplace_address?.municipality ?? hit.workplace_address?.city,
        ),
        url: hit.webpage_url,
        sourceUrl: hit.webpage_url,
        ...(hit.application_details?.url
            ? { url: hit.application_details.url }
            : {}),
        description: cleanText(hit.description?.text),
        applicationDeadline: formatDeadline(hit.application_deadline),
        availability: hit.removed ? 'closed' : 'active',
    };
}

export class ArbetsformedlingenSource implements JobSource {
    public readonly name = 'arbetsformedlingen.se';

    public constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    public async search(query: string): Promise<ScrapedJob[]> {
        const url = new URL(arbetsformedlingenSearchUrl);
        url.searchParams.set('q', query);

        const response = await this.fetchImpl(url, {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'Lokisjobb/0.1 (local personal job search)',
            },
        });

        if (!response.ok) {
            throw new Error(
                `Arbetsförmedlingen request failed with HTTP ${response.status}`,
            );
        }

        const data = (await response.json()) as JobSearchResponse;
        return (data.hits ?? [])
            .map(mapArbetsformedlingenHit)
            .filter((job): job is ScrapedJob => job !== null);
    }
}
