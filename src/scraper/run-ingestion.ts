import type { JobProvider } from '../providers/job-provider.js';
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
