import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import {
    RunHistoryRepository,
    type RunCompletion,
    type RunSummary,
} from './database/run-history.js';

function isCompletionStatus(
    value: unknown,
): value is RunCompletion['status'] {
    return (
        value === 'success' ||
        value === 'partial' ||
        value === 'failed' ||
        value === 'skipped' ||
        value === 'no_update'
    );
}

function parseCompletion(value: string): RunCompletion {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Completion data must be a JSON object.');
    }

    const record = parsed as Record<string, unknown>;
    if (!isCompletionStatus(record.status)) {
        throw new Error('Completion data has an invalid status.');
    }
    if (
        typeof record.summary !== 'object' ||
        record.summary === null ||
        Array.isArray(record.summary)
    ) {
        throw new Error('Completion data must include a summary object.');
    }

    const summary: RunSummary = {};
    for (const [key, item] of Object.entries(record.summary)) {
        if (
            item !== null &&
            typeof item !== 'string' &&
            typeof item !== 'number' &&
            typeof item !== 'boolean'
        ) {
            throw new Error(`Summary field "${key}" must be a scalar value.`);
        }
        summary[key] = item;
    }

    if (
        record.errorMessage !== undefined &&
        typeof record.errorMessage !== 'string'
    ) {
        throw new Error('errorMessage must be a string when provided.');
    }

    return {
        status: record.status,
        summary,
        ...(record.errorMessage === undefined
            ? {}
            : { errorMessage: record.errorMessage }),
    };
}

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
            history.complete(id, parseCompletion(args[1]));
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
