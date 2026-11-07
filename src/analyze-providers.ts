import path from 'node:path';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { analyzeProviderRedundancy } from './analysis/provider-redundancy.js';
import { getConfig } from './config/config.js';

async function main() {
    const config = getConfig();
    const dbPath = path.resolve(config.databasePath);
    const db = createDatabase(dbPath);
    const repo = new JobsRepository(db);

    const jobs = repo.list();
    const report = analyzeProviderRedundancy(jobs);

    console.log(`=== Analys av överlapp mellan jobbportaler ===`);
    console.log(`Unika jobb totalt: ${report.totalUniqueJobs}\n`);

    console.log(`--- Källstatistik ---`);
    for (const source of report.sources) {
        const tag = source.noExclusiveJobs ? ' [inga unika jobb]' : '';
        console.log(
            `• ${source.name}: ${source.totalJobs} jobb (${source.coveragePercentage} %), ${source.exclusiveJobs} unika jobb${tag}`,
        );
    }

    console.log(`\n--- Minsta källkombinationer (100 % täckning) ---`);
    if (report.minimalCovers.length === 0) {
        console.log('Ingen enskild kombination täcker 100 % av jobben.');
    } else {
        // Show top 3 minimal covers
        const topCovers = report.minimalCovers.slice(0, 3);
        for (const cover of topCovers) {
            console.log(
                `[ ${cover.sources.join(', ')} ] -> Täcker ${cover.coveragePercentage} % av jobben`,
            );
        }
    }

    db.close();
}

main().catch((error) => {
    console.error('Det gick inte att analysera källornas överlapp:', error);
    process.exit(1);
});
