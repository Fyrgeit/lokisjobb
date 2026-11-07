import path from 'node:path';
import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { evaluateJobWithGemini } from './evaluator/gemini-evaluator.js';

async function main() {
    const config = getConfig();
    if (!config.geminiApiKey) {
        console.error('Fel: Miljövariabeln GEMINI_API_KEY måste anges för AI-klassificering.');
        process.exit(1);
    }

    const dbPath = path.resolve(config.databasePath);
    const database = createDatabase(dbPath);
    const repository = new JobsRepository(database);

    const jobs = repository.list();
    const unevaluatedJobs = jobs.filter((job) => job.aiCategory === null);

    console.log(`Hittade ${unevaluatedJobs.length} okategoriserade jobb av ${jobs.length} totalt.`);

    for (const job of unevaluatedJobs) {
        console.log(`Klassificerar jobb #${job.id}: "${job.title}" hos ${job.company ?? 'okänt företag'}...`);
        try {
            const { category } = await evaluateJobWithGemini(
                job,
                config.geminiApiKey,
                config.geminiModel,
            );
            repository.updateAiCategory(job.id, category);
            console.log(` -> Kategori: ${category}`);
        } catch (error: unknown) {
            console.error(
                `Det gick inte att klassificera jobb #${job.id}:`,
                error instanceof Error ? error.message : error,
            );
        }
    }

    database.close();
    console.log('Klassificeringen är klar.');
}

main().catch((error) => {
    console.error('AI-klassificeringen misslyckades:', error);
    process.exit(1);
});
