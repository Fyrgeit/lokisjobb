import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { createDatabase } from './database.js';
import {
    RunHistoryRepository,
    withRunHistory,
} from './run-history.js';

it('persists completed and failed runs in newest-first order', () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'lokisjobb-run-history-'),
    );
    const databasePath = path.join(directory, 'jobs.db');
    let database: ReturnType<typeof createDatabase> | undefined;

    try {
        database = createDatabase(databasePath);
        const history = new RunHistoryRepository(database);
        const fetchId = history.start(
            'fetch',
            '2026-11-20T10:42:00.000Z',
        );
        history.complete(fetchId, {
            status: 'success',
            summary: { found: 18, added: 4, updated: 12, skipped: 2 },
            durationMs: 8300,
            completedAt: '2026-11-20T10:42:08.300Z',
        });

        const classificationId = history.start(
            'ai_classification',
            '2026-11-20T10:43:00.000Z',
        );
        history.complete(classificationId, {
            status: 'failed',
            summary: {},
            durationMs: 1200,
            errorMessage: 'Gemini unavailable',
            completedAt: '2026-11-20T10:43:01.200Z',
        });

        assert.deepEqual(history.list(), [
            {
                id: classificationId,
                operation: 'ai_classification',
                startedAt: '2026-11-20T10:43:00.000Z',
                completedAt: '2026-11-20T10:43:01.200Z',
                durationMs: 1200,
                status: 'failed',
                summary: {},
                errorMessage: 'Gemini unavailable',
            },
            {
                id: fetchId,
                operation: 'fetch',
                startedAt: '2026-11-20T10:42:00.000Z',
                completedAt: '2026-11-20T10:42:08.300Z',
                durationMs: 8300,
                status: 'success',
                summary: { found: 18, added: 4, updated: 12, skipped: 2 },
                errorMessage: null,
            },
        ]);
    } finally {
        database?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

it('records and rethrows errors from failed operations', async () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'lokisjobb-run-history-failure-'),
    );
    const databasePath = path.join(directory, 'jobs.db');
    let database: ReturnType<typeof createDatabase> | undefined;

    try {
        database = createDatabase(databasePath);
        const history = new RunHistoryRepository(database);
        await assert.rejects(
            withRunHistory(
                history,
                'fetch',
                async () => {
                    throw new Error('Provider unavailable');
                },
                () =>
                    assert.fail(
                        'failed operations should not be summarized',
                    ),
            ),
            /Provider unavailable/,
        );

        const [entry] = history.list();
        assert.equal(entry.status, 'failed');
        assert.equal(entry.errorMessage, 'Provider unavailable');
        assert.deepEqual(entry.summary, {});
        assert.notEqual(entry.completedAt, null);
    } finally {
        database?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
