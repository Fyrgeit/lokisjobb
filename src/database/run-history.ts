import type Database from 'better-sqlite3';

export type RunOperation = 'fetch' | 'ai_classification';
export type RunStatus =
    | 'running'
    | 'success'
    | 'partial'
    | 'failed'
    | 'skipped';

export interface RunHistoryEntry {
    id: number;
    operation: RunOperation;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    status: RunStatus;
    summary: Record<string, number | string>;
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
    summary: Record<string, number | string>;
    durationMs: number;
    errorMessage?: string;
    completedAt?: string;
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
        this.database
            .prepare(
                `UPDATE run_history
                 SET completed_at = ?, duration_ms = ?, status = ?,
                     summary_json = ?, error_message = ?
                 WHERE id = ?`,
            )
            .run(
                completion.completedAt ?? new Date().toISOString(),
                completion.durationMs,
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
            summary: JSON.parse(row.summary_json) as Record<
                string,
                number | string
            >,
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
