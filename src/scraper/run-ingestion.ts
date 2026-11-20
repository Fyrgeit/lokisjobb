import type { JobProvider } from '../providers/job-provider.js';
import type { JobsRepository } from '../database/jobs.js';
import {
    RunHistoryRepository,
    withRunHistory,
    type RunCompletion,
} from '../database/run-history.js';
import {
    ingestFromSource,
    type JobIngestionRepository,
    type IngestionSummary,
} from './ingestion.js';

export interface IngestionCallbacks {
    onQuery(query: string): void;
    onProviderStart(provider: JobProvider, query: string): void;
    onProviderComplete(
        provider: JobProvider,
        query: string,
        summary: IngestionSummary,
    ): void;
    onProviderError(provider: JobProvider, query: string, error: unknown): void;
}

export function summarizeFetchRun(
    totals: IngestionSummary,
    failedProviderQueries: number,
): Omit<RunCompletion, 'durationMs' | 'completedAt'> {
    return {
        status: failedProviderQueries > 0 ? 'partial' : 'success',
        summary: {
            source: 'Alla källor',
            found: totals.found,
            added: totals.added,
            updated: totals.updated,
            skipped: totals.skipped,
            failed: failedProviderQueries,
        },
    };
}

export interface FetchRunResult {
    totals: IngestionSummary;
    failedProviderQueries: number;
}

export async function runFetchWithHistory(
    history: RunHistoryRepository,
    searchQueries: string[],
    providers: JobProvider[],
    repository: Pick<JobsRepository, 'upsert' | 'list'>,
    callbacks: IngestionCallbacks,
): Promise<FetchRunResult> {
    let failedProviderQueries = 0;
    const totals = await withRunHistory(
        history,
        'fetch',
        () =>
            runIngestion(searchQueries, providers, repository, {
                ...callbacks,
                onProviderError: (provider, query, error) => {
                    failedProviderQueries += 1;
                    callbacks.onProviderError(provider, query, error);
                },
            }),
        (result) => summarizeFetchRun(result, failedProviderQueries),
    );
    return { totals, failedProviderQueries };
}

export async function runIngestion(
    searchQueries: string[],
    providers: JobProvider[],
    repository: JobIngestionRepository,
    callbacks: IngestionCallbacks,
): Promise<IngestionSummary> {
    const totals: IngestionSummary = {
        found: 0,
        added: 0,
        updated: 0,
        skipped: 0,
    };

    for (const query of searchQueries) {
        callbacks.onQuery(query);
        for (const provider of providers) {
            try {
                callbacks.onProviderStart(provider, query);
                const summary = await ingestFromSource(
                    provider,
                    query,
                    repository,
                );
                totals.found += summary.found;
                totals.added += summary.added;
                totals.updated += summary.updated;
                totals.skipped += summary.skipped;
                callbacks.onProviderComplete(provider, query, summary);
            } catch (error: unknown) {
                callbacks.onProviderError(provider, query, error);
            }
        }
    }

    return totals;
}
