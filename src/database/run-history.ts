import type Database from 'better-sqlite3';

export type RunOperation = 'fetch' | 'ai_classification' | 'deployment';
export type RunStatus =
    | 'running'
    | 'success'
    | 'partial'
    | 'failed'
    | 'skipped'
    | 'no_update';
export type RunSummaryValue = string | number | boolean | null;
export type RunSummary = Record<string, RunSummaryValue>;

export interface RunHistoryEntry {
    id: number;
    operation: RunOperation;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    status: RunStatus;
    summary: RunSummary;
    errorMessage: string | null;
}

interface RunHistoryRow {
    id: number;
    operation: RunOperation;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    status: RunStatus;
    summary_json: string;
    error_message: string | null;
}

export interface RunCompletion {
    status: Exclude<RunStatus, 'running'>;
    summary: RunSummary;
    durationMs?: number;
    errorMessage?: string;
    completedAt?: string;
}

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

export function parseRunCompletion(value: string): RunCompletion {
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

export class RunHistoryRepository {
    public constructor(private readonly database: Database.Database) {}

    public start(
        operation: RunOperation,
        startedAt = new Date().toISOString(),
    ): number {
        const result = this.database
            .prepare(
                `INSERT INTO run_history (operation, started_at, status)
                 VALUES (?, ?, 'running')`,
            )
            .run(operation, startedAt);
        return Number(result.lastInsertRowid);
    }

    public complete(id: number, completion: RunCompletion): void {
        const completedAt = completion.completedAt ?? new Date().toISOString();
        let durationMs = completion.durationMs;
        if (durationMs === undefined) {
            const row = this.database
                .prepare('SELECT started_at FROM run_history WHERE id = ?')
                .get(id) as { started_at: string } | undefined;
            if (!row) {
                throw new Error(`Run history entry ${id} does not exist.`);
            }

            const startedAt = Date.parse(row.started_at);
            const completedAtMs = Date.parse(completedAt);
            if (!Number.isFinite(startedAt) || !Number.isFinite(completedAtMs)) {
                throw new Error('Run history timestamps must be valid dates.');
            }
            durationMs = Math.max(0, completedAtMs - startedAt);
        }

        this.database
            .prepare(
                `UPDATE run_history
                 SET completed_at = ?, duration_ms = ?, status = ?,
                     summary_json = ?, error_message = ?
                 WHERE id = ?`,
            )
            .run(
                completedAt,
                durationMs,
                completion.status,
                JSON.stringify(completion.summary),
                completion.errorMessage ?? null,
                id,
            );
    }

    public list(limit = 50): RunHistoryEntry[] {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new RangeError('Run history limit must be between 1 and 100.');
        }

        const rows = this.database
            .prepare(
                `SELECT id, operation, started_at, completed_at, duration_ms,
                        status, summary_json, error_message
                 FROM run_history
                 ORDER BY id DESC
                 LIMIT ?`,
            )
            .all(limit) as RunHistoryRow[];

        return rows.map((row) => ({
            id: row.id,
            operation: row.operation,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            durationMs: row.duration_ms,
            status: row.status,
            summary: JSON.parse(row.summary_json) as RunSummary,
            errorMessage: row.error_message,
        }));
    }
}

export async function withRunHistory<T>(
    history: RunHistoryRepository,
    operation: RunOperation,
    run: () => Promise<T>,
    summarize: (
        result: T,
    ) => Omit<RunCompletion, 'durationMs' | 'completedAt'>,
): Promise<T> {
    const startedAt = Date.now();
    const id = history.start(operation, new Date(startedAt).toISOString());

    try {
        const result = await run();
        history.complete(id, {
            ...summarize(result),
            durationMs: Date.now() - startedAt,
        });
        return result;
    } catch (error: unknown) {
        history.complete(id, {
            status: 'failed',
            summary: {},
            durationMs: Date.now() - startedAt,
            errorMessage:
                error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
