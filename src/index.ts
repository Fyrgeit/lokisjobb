import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { evaluateUnevaluatedJobs } from './evaluator/job-evaluation.js';
import { createProviders } from './providers/create-providers.js';
import { ingestFromSource } from './scraper/ingestion.js';

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
            console.log(`\n--- Söker efter: "${query}" ---`);
            for (const provider of providers) {
                try {
                    console.log(
                        `Söker efter "${query}" hos ${provider.name}...`,
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
                    console.log(`Hittade ${summary.found} jobb`);
                    console.log(`Lade till ${summary.added} nya jobb`);
                    console.log(`Uppdaterade ${summary.updated} befintliga jobb`);
                    console.log(`Hoppade över ${summary.skipped} ogiltiga jobb`);
                } catch (error: unknown) {
                    // One blocked or unavailable provider should not prevent the
                    // other providers from contributing jobs.
                    console.error(
                        `${provider.name} misslyckades för sökningen "${query}":`,
                        error instanceof Error ? error.message : error,
                    );
                }
            }
        }

        console.log(`\n--- Totalt ---`);
        console.log(`Hittade totalt: ${totals.found}`);
        console.log(`Tillagda totalt: ${totals.added}`);
        console.log(`Uppdaterade totalt: ${totals.updated}`);
        console.log(`Överhoppade totalt: ${totals.skipped}`);
        console.log(`Databasen innehåller nu ${repository.list().length} jobb`);

        // Run AI Evaluation on unevaluated jobs
        console.log(`\n--- AI-klassificering ---`);
        const evaluation = await evaluateUnevaluatedJobs(
            repository,
            config.geminiApiKey,
            config.geminiModel,
            {
                log: (message) => console.log(message),
                error: (message) => console.error(message),
            },
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
