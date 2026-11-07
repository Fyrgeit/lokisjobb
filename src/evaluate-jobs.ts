import path from 'node:path';
import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { evaluateUnevaluatedJobs } from './evaluator/job-evaluation.js';

async function main() {
    const config = getConfig();
    if (!config.geminiApiKey) {
        console.error('Fel: Miljövariabeln GEMINI_API_KEY måste anges för AI-klassificering.');
        process.exit(1);
    }

    const dbPath = path.resolve(config.databasePath);
    const database = createDatabase(dbPath);

    try {
        const repository = new JobsRepository(database);
        await evaluateUnevaluatedJobs(
            repository,
            config.geminiApiKey,
            config.geminiModel,
            {
                log: (message) => console.log(message),
                error: (message) => console.error(message),
            },
        );

        console.log('Klassificeringen är klar.');
    } finally {
        database.close();
    }
}

main().catch((error) => {
    console.error('AI-klassificeringen misslyckades:', error);
    process.exit(1);
});
