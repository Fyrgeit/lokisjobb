import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
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

it('migrates existing history and records deployment outcomes', () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'lokisjobb-run-history-migration-'),
    );
    const databasePath = path.join(directory, 'jobs.db');
    let legacyDatabase: Database.Database | undefined;
    let database: ReturnType<typeof createDatabase> | undefined;

    try {
        legacyDatabase = new Database(databasePath);
        legacyDatabase.exec(`
            CREATE TABLE run_history (
                id INTEGER PRIMARY KEY,
                operation TEXT NOT NULL CHECK (operation IN ('fetch', 'ai_classification')),
                started_at TEXT NOT NULL,
                completed_at TEXT,
                duration_ms INTEGER,
                status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped')),
                summary_json TEXT NOT NULL DEFAULT '{}',
                error_message TEXT
            );
            INSERT INTO run_history (
                id, operation, started_at, completed_at, duration_ms,
                status, summary_json
            ) VALUES (
                7, 'fetch', '2026-11-20T10:00:00.000Z',
                '2026-11-20T10:00:01.000Z', 1000, 'success', '{"found":1}'
            );
        `);
        legacyDatabase.close();
        legacyDatabase = undefined;

        database = createDatabase(databasePath);
        const history = new RunHistoryRepository(database);
        const deploymentId = history.start(
            'deployment',
            '2026-11-20T11:00:00.000Z',
        );
        history.complete(deploymentId, {
            status: 'success',
            summary: {
                previousCommit: 'abc1234',
                newCommit: 'def5678',
                dependenciesChanged: true,
                buildStatus: 'success',
                restartStatus: 'success',
            },
            durationMs: 12000,
            completedAt: '2026-11-20T11:00:12.000Z',
        });

        const noUpdateId = history.start(
            'deployment',
            '2026-11-20T12:00:00.000Z',
        );
        history.complete(noUpdateId, {
            status: 'no_update',
            summary: { reason: 'No new commits' },
            completedAt: '2026-11-20T12:00:03.000Z',
        });

        const failedId = history.start(
            'deployment',
            '2026-11-20T13:00:00.000Z',
        );
        history.complete(failedId, {
            status: 'failed',
            summary: { buildStatus: 'failed', restartStatus: 'not_run' },
            errorMessage: 'TypeScript compilation failed',
            completedAt: '2026-11-20T13:00:05.000Z',
        });

        assert.deepEqual(history.list(), [
            {
                id: failedId,
                operation: 'deployment',
                startedAt: '2026-11-20T13:00:00.000Z',
                completedAt: '2026-11-20T13:00:05.000Z',
                durationMs: 5000,
                status: 'failed',
                summary: { buildStatus: 'failed', restartStatus: 'not_run' },
                errorMessage: 'TypeScript compilation failed',
            },
            {
                id: noUpdateId,
                operation: 'deployment',
                startedAt: '2026-11-20T12:00:00.000Z',
                completedAt: '2026-11-20T12:00:03.000Z',
                durationMs: 3000,
                status: 'no_update',
                summary: { reason: 'No new commits' },
                errorMessage: null,
            },
            {
                id: deploymentId,
                operation: 'deployment',
                startedAt: '2026-11-20T11:00:00.000Z',
                completedAt: '2026-11-20T11:00:12.000Z',
                durationMs: 12000,
                status: 'success',
                summary: {
                    previousCommit: 'abc1234',
                    newCommit: 'def5678',
                    dependenciesChanged: true,
                    buildStatus: 'success',
                    restartStatus: 'success',
                },
                errorMessage: null,
            },
            {
                id: 7,
                operation: 'fetch',
                startedAt: '2026-11-20T10:00:00.000Z',
                completedAt: '2026-11-20T10:00:01.000Z',
                durationMs: 1000,
                status: 'success',
                summary: { found: 1 },
                errorMessage: null,
            },
        ]);
    } finally {
        legacyDatabase?.close();
        database?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
