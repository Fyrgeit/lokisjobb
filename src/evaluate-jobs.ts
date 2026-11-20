import path from 'node:path';
import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { evaluateUnevaluatedJobs } from './evaluator/job-evaluation.js';
import {
    RunHistoryRepository,
    withRunHistory,
} from './database/run-history.js';

async function main() {
    const config = getConfig();
    const dbPath = path.resolve(config.databasePath);
    const database = createDatabase(dbPath);

    try {
        const history = new RunHistoryRepository(database);
        if (!config.geminiApiKey) {
            await withRunHistory(
                history,
                'ai_classification',
                async () => null,
                () => ({
                    status: 'skipped',
                    summary: {
                        evaluated: 0,
                        failed: 0,
                        reason: 'GEMINI_API_KEY saknas',
                    },
                }),
            );
            console.error(
                'Fel: Miljövariabeln GEMINI_API_KEY måste anges för AI-klassificering.',
            );
            process.exitCode = 1;
            return;
        }

        const evaluation = await withRunHistory(
            history,
            'ai_classification',
            () =>
                evaluateUnevaluatedJobs(
                    new JobsRepository(database),
                    config.geminiApiKey,
                    config.geminiModel,
                    {
                        log: (message) => console.log(message),
                        error: (message) => console.error(message),
                    },
                ),
            (result) => ({
                status: result.failedCount > 0 ? 'partial' : 'success',
                summary: {
                    evaluated: result.evaluatedCount,
                    failed: result.failedCount,
                    remainingUnknown: result.remainingUnknownCount,
                },
            }),
        );

        console.log(
            `Klassificeringen är klar. Klassificerade: ${evaluation.evaluatedCount}, misslyckades: ${evaluation.failedCount}.`,
        );
    } finally {
        database.close();
    }
}

main().catch((error) => {
    console.error('AI-klassificeringen misslyckades:', error);
    process.exit(1);
});
