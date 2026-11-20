import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import {
    RunHistoryRepository,
    parseRunCompletion,
} from './database/run-history.js';

function usage(): string {
    return [
        'Usage:',
        '  node --env-file=.env dist/deployment-history.js start',
        '  node --env-file=.env dist/deployment-history.js complete <id> <completion-json>',
        '',
        'Completion JSON: {"status":"success|partial|failed|no_update","summary":{},"errorMessage":"optional"}',
    ].join('\n');
}

function main(): void {
    const [command, ...args] = process.argv.slice(2);
    const config = getConfig();
    const database = createDatabase(config.databasePath);

    try {
        const history = new RunHistoryRepository(database);
        if (command === 'start' && args.length === 0) {
            process.stdout.write(`${history.start('deployment')}\n`);
            return;
        }
        if (command === 'complete' && args.length === 2) {
            const id = Number(args[0]);
            if (!Number.isSafeInteger(id) || id < 1) {
                throw new Error('Run history ID must be a positive integer.');
            }
            history.complete(id, parseRunCompletion(args[1]));
            return;
        }
        throw new Error(usage());
    } finally {
        database.close();
    }
}

try {
    main();
} catch (error: unknown) {
    process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
}
