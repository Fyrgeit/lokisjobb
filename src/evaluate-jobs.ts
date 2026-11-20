import path from 'node:path';
import { getConfig } from './config/config.js';
import { withDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import {
    runEvaluationWithHistory,
} from './evaluator/job-evaluation.js';
import {
    RunHistoryRepository,
} from './database/run-history.js';

async function main() {
    const config = getConfig();
    await withDatabase(path.resolve(config.databasePath), async (database) => {
        const history = new RunHistoryRepository(database);
        const repository = new JobsRepository(database);
        if (!config.geminiApiKey) {
            await runEvaluationWithHistory(
                history,
                repository,
                null,
                config.geminiModel,
                {
                    log: (message) => console.log(message),
                    error: (message) => console.error(message),
                },
            );
            console.error(
                'Fel: Miljövariabeln GEMINI_API_KEY måste anges för AI-klassificering.',
            );
            process.exitCode = 1;
            return;
        }

        const evaluation = await runEvaluationWithHistory(
            history,
            repository,
            config.geminiApiKey,
            config.geminiModel,
            {
                log: (message) => console.log(message),
                error: (message) => console.error(message),
            },
        );

        console.log(
            `Klassificeringen är klar. Klassificerade: ${evaluation.evaluatedCount}, misslyckades: ${evaluation.failedCount}.`,
        );
    });
}

main().catch((error) => {
    console.error('AI-klassificeringen misslyckades:', error);
    process.exit(1);
});
