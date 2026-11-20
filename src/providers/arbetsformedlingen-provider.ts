import type { ScrapedJob } from '../types/job.js';
import {
    cleanProviderText,
    type JobProvider,
} from './job-provider.js';
import { fetchProviderJson } from './availability.js';

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
        company: cleanProviderText(hit.employer?.name),
        location: cleanProviderText(
            hit.workplace_address?.municipality ?? hit.workplace_address?.city,
        ),
        listingUrl: hit.webpage_url,
        ...(hit.application_details?.url
            ? { applicationUrl: hit.application_details.url }
            : {}),
        description: cleanProviderText(hit.description?.text),
        applicationDeadline: formatDeadline(hit.application_deadline),
        availability: hit.removed ? 'closed' : 'active',
    };
}

export class ArbetsformedlingenProvider implements JobProvider {
    public readonly name = 'arbetsformedlingen.se';

    public constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    public async search(query: string): Promise<ScrapedJob[]> {
        const url = new URL(arbetsformedlingenSearchUrl);
        url.searchParams.set('q', query);

        const data =
            (await fetchProviderJson(
                this.fetchImpl,
                url,
                'Arbetsförmedlingen',
            )) as JobSearchResponse;
        return (data.hits ?? [])
            .map(mapArbetsformedlingenHit)
            .filter((job): job is ScrapedJob => job !== null);
    }
}
