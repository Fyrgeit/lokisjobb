import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { evaluateUnevaluatedJobs } from './evaluator/job-evaluation.js';
import { createProviders } from './providers/create-providers.js';
import { runIngestion } from './scraper/run-ingestion.js';
import {
    RunHistoryRepository,
    withRunHistory,
} from './database/run-history.js';

async function main(): Promise<void> {
    // The CLI composes the application: configuration, database, provider, and
    // ingestion. None of those layers need to know about this entry point.
    const config = getConfig();
    const database = createDatabase(config.databasePath);
    const repository = new JobsRepository(database);
    const providers = createProviders();
    const history = new RunHistoryRepository(database);

    try {
        let failedProviderQueries = 0;
        const totals = await withRunHistory(
            history,
            'fetch',
            () =>
                runIngestion(
                    config.searchQueries,
                    providers,
                    repository,
                    {
                        onQuery: (query) =>
                            console.log(`\n--- Söker efter: "${query}" ---`),
                        onProviderStart: (provider, query) =>
                            console.log(
                                `Söker efter "${query}" hos ${provider.name}...`,
                            ),
                        onProviderComplete: (_provider, _query, summary) => {
                            console.log(`Hittade ${summary.found} jobb`);
                            console.log(`Lade till ${summary.added} nya jobb`);
                            console.log(
                                `Uppdaterade ${summary.updated} befintliga jobb`,
                            );
                            console.log(
                                `Hoppade över ${summary.skipped} ogiltiga jobb`,
                            );
                        },
                        onProviderError: (provider, query, error) => {
                            failedProviderQueries += 1;
                            console.error(
                                `${provider.name} misslyckades för sökningen "${query}":`,
                                error instanceof Error
                                    ? error.message
                                    : error,
                            );
                        },
                    },
                ),
            (result) => ({
                status: failedProviderQueries > 0 ? 'partial' : 'success',
                summary: {
                    source: 'Alla källor',
                    found: result.found,
                    added: result.added,
                    updated: result.updated,
                    skipped: result.skipped,
                    failed: failedProviderQueries,
                },
            }),
        );

        console.log(`\n--- Totalt ---`);
        console.log(`Hittade totalt: ${totals.found}`);
        console.log(`Tillagda totalt: ${totals.added}`);
        console.log(`Uppdaterade totalt: ${totals.updated}`);
        console.log(`Överhoppade totalt: ${totals.skipped}`);
        console.log(`Databasen innehåller nu ${repository.list().length} jobb`);

        // Run AI Evaluation on unevaluated jobs
        console.log(`\n--- AI-klassificering ---`);
        const evaluation = await withRunHistory(
            history,
            'ai_classification',
            () =>
                evaluateUnevaluatedJobs(
                    repository,
                    config.geminiApiKey,
                    config.geminiModel,
                    {
                        log: (message) => console.log(message),
                        error: (message) => console.error(message),
                    },
                ),
            (result) => ({
                status: !config.geminiApiKey
                    ? 'skipped'
                    : result.failedCount > 0
                      ? 'partial'
                      : 'success',
                summary: {
                    evaluated: result.evaluatedCount,
                    failed: result.failedCount,
                    remainingUnknown: result.remainingUnknownCount,
                },
            }),
        );
        if (config.geminiApiKey) {
            console.log(
                `AI-klassificeringen är klar. Klassificerade ${evaluation.evaluatedCount} jobb.`,
            );
        }
    } finally {
        database.close();
    }
}

main().catch((error: unknown) => {
    console.error('Jobbsökningen misslyckades:', error);
    process.exitCode = 1;
});
