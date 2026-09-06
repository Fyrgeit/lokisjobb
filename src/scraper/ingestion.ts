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

export async function ingestFromSource(
    source: JobSource,
    query: string,
    repository: JobsRepository,
): Promise<IngestionSummary> {
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

        const normalizedJob: ScrapedJob = {
            ...job,
            title: job.title.trim(),
            url: job.url.trim(),
        };
        const result = repository.upsert(normalizedJob);
        summary[result === 'inserted' ? 'added' : 'updated'] += 1;
    }

    return summary;
}
