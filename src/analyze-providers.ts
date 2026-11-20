import path from 'node:path';
import { withDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { analyzeProviderRedundancy } from './analysis/provider-redundancy.js';
import { getConfig } from './config/config.js';

async function main() {
    const config = getConfig();
    const dbPath = path.resolve(config.databasePath);
    await withDatabase(dbPath, async (db) => {
        const repo = new JobsRepository(db);
        const jobs = repo.list();
        const report = analyzeProviderRedundancy(jobs);

        console.log(`=== Analys av överlapp mellan jobbportaler ===`);
        console.log(`Unika jobb totalt: ${report.totalUniqueJobs}\n`);

        console.log(`--- Leverantörsstatistik ---`);
        for (const provider of report.providers) {
            const tag = provider.noExclusiveJobs ? ' [inga unika jobb]' : '';
            console.log(
                `• ${provider.name}: ${provider.totalJobs} jobb (${provider.coveragePercentage} %), ${provider.exclusiveJobs} unika jobb${tag}`,
            );
        }

        console.log(`\n--- Minsta leverantörskombinationer (100 % täckning) ---`);
        if (report.minimalCovers.length === 0) {
            console.log('Ingen enskild kombination täcker 100 % av jobben.');
        } else {
            const topCovers = report.minimalCovers.slice(0, 3);
            for (const cover of topCovers) {
                console.log(
                    `[ ${cover.providers.join(', ')} ] -> Täcker ${cover.coveragePercentage} % av jobben`,
                );
            }
        }
    });
}

main().catch((error) => {
    console.error('Det gick inte att analysera leverantörernas överlapp:', error);
    process.exit(1);
});
