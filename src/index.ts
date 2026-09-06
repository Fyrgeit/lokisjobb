import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { ingestFromSource } from './scraper/ingestion.js';
import { JarnvagsjobbSource } from './sources/jarnvagsjobb-source.js';

async function main(): Promise<void> {
    // The CLI composes the application: configuration, database, source, and
    // ingestion. None of those layers need to know about this entry point.
    const config = getConfig();
    const database = createDatabase(config.databasePath);
    const repository = new JobsRepository(database);
    const source = new JarnvagsjobbSource();

    try {
        console.log(`Starting job search with ${source.name} source...`);
        const summary = await ingestFromSource(
            source,
            config.searchQuery,
            repository,
        );
        console.log(`Found ${summary.found} jobs`);
        console.log(`Added ${summary.added} new jobs`);
        console.log(`Updated ${summary.updated} existing jobs`);
        console.log(`Skipped ${summary.skipped} invalid jobs`);
        console.log(`Database now contains ${repository.list().length} jobs`);
    } finally {
        database.close();
    }
}

main().catch((error: unknown) => {
    console.error('Job search failed:', error);
    process.exitCode = 1;
});
