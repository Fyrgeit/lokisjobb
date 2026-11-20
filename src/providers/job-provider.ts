import type { ScrapedJob } from '../types/job.js';

// Every provider follows the same small contract, allowing ingestion to remain
// independent of the website or API being queried.
export interface JobProvider {
    name: string;
    search(query: string): Promise<ScrapedJob[]>;
}

export function cleanProviderText(
    value: string | undefined,
): string | null {
    const text = value?.replace(/\s+/g, ' ').trim();
    return text || null;
}

export function providerErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function warnProviderDetailFailure(
    providerName: string,
    listingUrl: string,
    error: unknown,
): void {
    console.warn(
        `Det gick inte att hämta jobbdetaljer från ${providerName} (${listingUrl}): ${providerErrorMessage(error)}`,
    );
}
