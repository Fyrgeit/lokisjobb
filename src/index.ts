import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { ingestFromSource } from './scraper/ingestion.js';
import { ArbetsformedlingenSource } from './sources/arbetsformedlingen-source.js';
import { IndeedSource } from './sources/indeed-source.js';
import { JarnvagsjobbSource } from './sources/jarnvagsjobb-source.js';
import { JobblandSource } from './sources/jobbland-source.js';
import { JobbsafariSource } from './sources/jobbsafari-source.js';
import type { JobSource } from './sources/job-source.js';

function createSources(jobSource: string): JobSource[] {
    if (jobSource === 'all') {
        // Keep this list explicit so adding a source is visible at the CLI
        // boundary and the order of network requests stays predictable.
        return [
            new JarnvagsjobbSource(),
            new ArbetsformedlingenSource(),
            new JobblandSource(),
            new JobbsafariSource(),
            new IndeedSource(),
        ];
    }

    return [
        jobSource === 'indeed'
            ? new IndeedSource()
            : jobSource === 'arbetsformedlingen'
              ? new ArbetsformedlingenSource()
              : jobSource === 'jobbsafari'
                ? new JobbsafariSource()
                : jobSource === 'jobbland'
                  ? new JobblandSource()
                  : new JarnvagsjobbSource(),
    ];
}

async function main(): Promise<void> {
    // The CLI composes the application: configuration, database, source, and
    // ingestion. None of those layers need to know about this entry point.
    const config = getConfig();
    const database = createDatabase(config.databasePath);
    const repository = new JobsRepository(database);
    const sources = createSources(config.jobSource);

    try {
        const totals = { found: 0, added: 0, updated: 0, skipped: 0 };

        for (const source of sources) {
            try {
                console.log(
                    `Starting job search with ${source.name} source...`,
                );
                const summary = await ingestFromSource(
                    source,
                    config.searchQuery,
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
                // One blocked or unavailable source should not prevent the
                // other sources from contributing jobs.
                console.error(
                    `${source.name} failed:`,
                    error instanceof Error ? error.message : error,
                );
            }
        }

        if (sources.length > 1) {
            console.log(`Total found: ${totals.found}`);
            console.log(`Total added: ${totals.added}`);
            console.log(`Total updated: ${totals.updated}`);
            console.log(`Total skipped: ${totals.skipped}`);
        }
        console.log(`Database now contains ${repository.list().length} jobs`);
    } finally {
        database.close();
    }
}

main().catch((error: unknown) => {
    console.error('Job search failed:', error);
    process.exitCode = 1;
});
