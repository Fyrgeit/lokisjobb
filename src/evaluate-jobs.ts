import path from 'node:path';
import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { evaluateJobWithGemini } from './evaluator/gemini-evaluator.js';

async function main() {
    const config = getConfig();
    if (!config.geminiApiKey) {
        console.error('Error: GEMINI_API_KEY environment variable is required for AI evaluation.');
        process.exit(1);
    }

    const dbPath = path.resolve(config.databasePath);
    const database = createDatabase(dbPath);
    const repository = new JobsRepository(database);

    const jobs = repository.list();
    const unevaluatedJobs = jobs.filter((job) => job.aiScore === null);

    console.log(`Found ${unevaluatedJobs.length} unevaluated jobs out of ${jobs.length} total.`);

    for (const job of unevaluatedJobs) {
        console.log(`Evaluating job #${job.id}: "${job.title}" at ${job.company ?? 'Unknown'}...`);
        try {
            const { score, reasoning } = await evaluateJobWithGemini(
                job,
                config.geminiApiKey,
                config.geminiModel,
            );
            repository.updateAiScore(job.id, score);
            console.log(` -> Score: ${score} (${reasoning})`);
        } catch (error: unknown) {
            console.error(
                `Failed to evaluate job #${job.id}:`,
                error instanceof Error ? error.message : error,
            );
        }
    }

    database.close();
    console.log('Evaluation complete.');
}

main().catch((error) => {
    console.error('Job evaluation failed:', error);
    process.exit(1);
});
