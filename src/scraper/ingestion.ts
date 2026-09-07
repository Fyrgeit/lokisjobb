import type { JobsRepository } from '../database/jobs.js';
import type { JobSource } from '../sources/job-source.js';
import type { ScrapedJob } from '../types/job.js';

export interface IngestionSummary {
    found: number;
    added: number;
    updated: number;
    skipped: number;
}

// This employer currently represents an AI matching service rather than a
// direct vacancy, so exclude it consistently across every source.
const ignoredCompanies = new Set(['ren labs stockholm ab']);

function isIgnoredCompany(company: string | null): boolean {
    return (
        company !== null && ignoredCompanies.has(company.trim().toLowerCase())
    );
}

function isValidJob(job: ScrapedJob): boolean {
    // Reject malformed source output before it reaches the repository. URL
    // validation also prevents unusable links from entering the database.
    if (!job.title.trim() || !job.url.trim()) {
        return false;
    }

    try {
        new URL(job.url);
        return true;
    } catch {
        return false;
    }
}

export function canonicalizeApplicationUrl(url: string): string {
    const parsedUrl = new URL(url);

    // Application links often include source-specific tracking parameters.
    // They describe the click, not the vacancy, so they must not create new
    // job identities across aggregators.
    for (const parameter of [...parsedUrl.searchParams.keys()]) {
        if (
            parameter.toLowerCase().startsWith('utm_') ||
            parameter.toLowerCase() === 'promotion'
        ) {
            parsedUrl.searchParams.delete(parameter);
        }
    }

    if (parsedUrl.hostname === 'jobb.sj.se') {
        parsedUrl.search = '';
    }

    // Jobylon exposes the same vacancy through both /jobs/{id}-... and
    // /applications/jobs/{id}/create/. Collapse those forms so syndicated
    // listings share one database identity while retaining sourceUrl.
    const jobylonMatch = parsedUrl
        .toString()
        .match(
            /^https:\/\/emp\.jobylon\.com\/(?:jobs\/(\d+)[^/]*|applications\/jobs\/(\d+))/i,
        );
    return jobylonMatch
        ? `https://emp.jobylon.com/jobs/${jobylonMatch[1] ?? jobylonMatch[2]}`
        : parsedUrl.toString();
}

export async function ingestFromSource(
    source: JobSource,
    query: string,
    repository: JobsRepository,
): Promise<IngestionSummary> {
    // This is the only boundary where a source result becomes persisted data.
    const jobs = await source.search(query);
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

        // Trim the fields that are used for identity or display while keeping
        // the source's optional values intact.
        const normalizedJob: ScrapedJob = {
            ...job,
            title: job.title.trim(),
            url: canonicalizeApplicationUrl(job.url.trim()),
            sourceUrl: job.sourceUrl.trim(),
        };
        const result = repository.upsert(normalizedJob, source.name);
        summary[result === 'inserted' ? 'added' : 'updated'] += 1;
    }

    return summary;
}
