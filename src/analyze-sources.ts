import path from 'node:path';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { analyzeSourceRedundancy } from './analysis/source-redundancy.js';
import { getConfig } from './config/config.js';

async function main() {
    const config = getConfig();
    const dbPath = path.resolve(config.databasePath);
    const db = createDatabase(dbPath);
    const repo = new JobsRepository(db);

    const jobs = repo.list();
    const report = analyzeSourceRedundancy(jobs);

    console.log(`=== Job Source Redundancy Analysis ===`);
    console.log(`Total Unique Jobs: ${report.totalUniqueJobs}\n`);

    console.log(`--- Source Statistics ---`);
    for (const source of report.sources) {
        console.log(
            `• ${source.name}: ${source.totalJobs} jobs (${source.coveragePercentage}%), ${source.exclusiveJobs} exclusive jobs`,
        );
    }

    console.log(`\n--- Minimal Source Combinations (100% Coverage) ---`);
    if (report.minimalCovers.length === 0) {
        console.log('No single combination covers 100% of jobs.');
    } else {
        // Show top 3 minimal covers
        const topCovers = report.minimalCovers.slice(0, 3);
        for (const cover of topCovers) {
            console.log(`[ ${cover.sources.join(', ')} ] -> Covers ${cover.coveragePercentage}% of jobs`);
        }
    }

    db.close();
}

main().catch((error) => {
    console.error('Error running source redundancy analysis:', error);
    process.exit(1);
});
