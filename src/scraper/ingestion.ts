import type { JobsRepository } from '../database/jobs.js';
import type { JobSource } from '../sources/job-source.js';
import type { ScrapedJob } from '../types/job.js';

export interface IngestionSummary {
    found: number;
    added: number;
    updated: number;
    skipped: number;
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

function canonicalizeApplicationUrl(url: string): string {
    // Jobylon exposes the same vacancy through both /jobs/{id}-... and
    // /applications/jobs/{id}/create/. Collapse those forms so syndicated
    // listings share one database identity while retaining sourceUrl.
    const jobylonMatch = url.match(
        /^https:\/\/emp\.jobylon\.com\/(?:jobs\/(\d+)[^/]*|applications\/jobs\/(\d+))/i,
    );
    return jobylonMatch
        ? `https://emp.jobylon.com/jobs/${jobylonMatch[1] ?? jobylonMatch[2]}`
        : url;
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
        if (!isValidJob(job)) {
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
        const result = repository.upsert(normalizedJob);
        summary[result === 'inserted' ? 'added' : 'updated'] += 1;
    }

    return summary;
}
