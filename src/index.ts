import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { ingestFromSource } from './scraper/ingestion.js';
import { ArbetsformedlingenProvider } from './providers/arbetsformedlingen-provider.js';
import { JarnvagsjobbProvider } from './providers/jarnvagsjobb-provider.js';
import { JobblandProvider } from './providers/jobbland-provider.js';
import { JobbsafariProvider } from './providers/jobbsafari-provider.js';
import type { JobProvider } from './providers/job-provider.js';

function createProviders(): JobProvider[] {
    // Keep the registry explicit so adding a provider is visible at the CLI
    // boundary and the order of network requests stays predictable.
    return [
        new JarnvagsjobbProvider(),
        new ArbetsformedlingenProvider(),
        new JobblandProvider(),
        new JobbsafariProvider(),
    ];
}

async function main(): Promise<void> {
    // The CLI composes the application: configuration, database, provider, and
    // ingestion. None of those layers need to know about this entry point.
    const config = getConfig();
    const database = createDatabase(config.databasePath);
    const repository = new JobsRepository(database);
    const providers = createProviders();

    try {
        const totals = { found: 0, added: 0, updated: 0, skipped: 0 };

        for (const query of config.searchQueries) {
            console.log(`\n--- Searching for query: "${query}" ---`);
            for (const provider of providers) {
                try {
                    console.log(
                        `Starting job search with ${provider.name} provider for "${query}"...`,
                    );
                    const summary = await ingestFromSource(
                        provider,
                        query,
                        repository,
                    );
                    totals.found += summary.found;
                    totals.added += summary.added;
                    totals.updated += summary.updated;
                    totals.skipped += summary.skipped;
                    console.log(`Found ${summary.found} jobs`);
                    console.log(`Added ${summary.added} new jobs`);
                    console.log(`Updated ${summary.updated} existing jobs`);
                    console.log(`Skipped ${summary.skipped} invalid jobs`);
                } catch (error: unknown) {
                    // One blocked or unavailable provider should not prevent the
                    // other providers from contributing jobs.
                    console.error(
                        `${provider.name} failed for query "${query}":`,
                        error instanceof Error ? error.message : error,
                    );
                }
            }
        }

        console.log(`\n--- Overall Totals ---`);
        console.log(`Total found: ${totals.found}`);
        console.log(`Total added: ${totals.added}`);
        console.log(`Total updated: ${totals.updated}`);
        console.log(`Total skipped: ${totals.skipped}`);
        console.log(`Database now contains ${repository.list().length} jobs`);
    } finally {
        database.close();
    }
}

main().catch((error: unknown) => {
    console.error('Job search failed:', error);
    process.exitCode = 1;
});
