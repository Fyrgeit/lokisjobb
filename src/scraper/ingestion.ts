import type { JobsRepository } from '../database/jobs.js';
import type { JobProvider } from '../providers/job-provider.js';
import type { IngestedJob, ScrapedJob } from '../types/job.js';

export interface IngestionSummary {
    found: number;
    added: number;
    updated: number;
    skipped: number;
}

export type JobIngestionRepository = Pick<JobsRepository, 'upsert'>;

// This employer currently represents an AI matching service rather than a
// direct vacancy, so exclude it consistently across every provider.
const ignoredCompanies = new Set(['ren labs stockholm ab']);

function isIgnoredCompany(company: string | null): boolean {
    return (
        company !== null && ignoredCompanies.has(company.trim().toLowerCase())
    );
}

function isValidJob(job: ScrapedJob): boolean {
    if (!job.title.trim() || !isHttpUrl(job.listingUrl)) {
        return false;
    }

    try {
        if (job.applicationUrl) {
            const applicationUrl = new URL(job.applicationUrl);
            return (
                ['http:', 'https:', 'mailto:'].includes(applicationUrl.protocol)
            );
        }
    } catch {
        return false;
    }

    return true;
}

function isHttpUrl(value: string): boolean {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

export function stripTrackingParameters(url: string): string {
    const parsedUrl = new URL(url);
    for (const parameter of [...parsedUrl.searchParams.keys()]) {
        if (
            parameter.toLowerCase().startsWith('utm_') ||
            parameter.toLowerCase() === 'promotion'
        ) {
            parsedUrl.searchParams.delete(parameter);
        }
    }

    return parsedUrl.toString();
}

export function canonicalizeApplicationUrl(url: string): string {
    const parsedUrl = new URL(stripTrackingParameters(url));

    if (parsedUrl.hostname === 'jobb.sj.se') {
        parsedUrl.search = '';
    }

    // Jobylon exposes the same vacancy through both /jobs/{id}-... and
    // /applications/jobs/{id}/create/. Collapse those forms for deduplication.
    const jobylonMatch = parsedUrl
        .toString()
        .match(
            /^https:\/\/emp\.jobylon\.com\/(?:jobs\/(\d+)[^/]*|applications\/jobs\/(\d+))/i,
        );
    if (jobylonMatch) {
        return `https://emp.jobylon.com/jobs/${jobylonMatch[1] ?? jobylonMatch[2]}`;
    }

    const rmJob = parsedUrl.searchParams.get('rmjob');
    if (parsedUrl.hostname.includes('reachmee.com') && rmJob) {
        return `https://${parsedUrl.hostname}/ext/job?rmjob=${rmJob}`;
    }

    return parsedUrl.toString();
}

export async function ingestFromSource(
    provider: JobProvider,
    query: string,
    repository: JobIngestionRepository,
): Promise<IngestionSummary> {
    // This is the only boundary where a provider result becomes persisted data.
    const jobs = await provider.search(query);
    const summary: IngestionSummary = {
        found: jobs.length,
        added: 0,
        updated: 0,
        skipped: 0,
    };

    for (const job of jobs) {
        if (isIgnoredCompany(job.company) || !isValidJob(job)) {
            summary.skipped += 1;
            continue;
        }

        const listingUrl = job.listingUrl.trim();
        const sourceApplicationUrl = job.applicationUrl?.trim() || null;
        const applicationUrl =
            sourceApplicationUrl && isHttpUrl(sourceApplicationUrl)
                ? stripTrackingParameters(sourceApplicationUrl)
                : sourceApplicationUrl;
        const normalizedJob: ScrapedJob = {
            ...job,
            title: job.title.trim(),
            listingUrl,
            applicationUrl,
        };
        const ingestedJob: IngestedJob = {
            ...normalizedJob,
            canonicalUrl:
                applicationUrl && isHttpUrl(applicationUrl)
                    ? canonicalizeApplicationUrl(applicationUrl)
                    : null,
        };
        console.log(
            `[Hämtning] Bearbetar jobb: "${ingestedJob.title}" (annons: ${ingestedJob.listingUrl}, ansökan: ${ingestedJob.applicationUrl ?? 'ej angiven'}) från ${provider.name}`,
        );
        const result = repository.upsert(ingestedJob, provider.name);
        summary[result === 'inserted' ? 'added' : 'updated'] += 1;
    }

    return summary;
}
