import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { it } from 'node:test';
import { createDatabase } from './database.js';

it('adds AI categories to an existing score-based database', () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'lokisjobb-db-migration-'),
    );
    const databasePath = path.join(directory, 'jobs.db');
    let database: Database.Database | undefined;

    try {
        const legacyDatabase = new Database(databasePath);
        legacyDatabase.exec(`
            CREATE TABLE jobs (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                company TEXT,
                location TEXT,
                url TEXT NOT NULL UNIQUE,
                description TEXT,
                discovered_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                ai_score REAL,
                status TEXT NOT NULL DEFAULT 'interested'
            );
            INSERT INTO jobs
                (title, url, discovered_at, last_seen_at, ai_score, status)
            VALUES
                ('Truck driver', 'https://example.com/job/1',
                 '2026-01-01', '2026-01-01', 0, 'interested');
        `);
        legacyDatabase.close();

        database = createDatabase(databasePath);
        const migratedJob = database
            .prepare('SELECT ai_category, ai_score, status FROM jobs WHERE id = 1')
            .get() as {
            ai_category: string | null;
            ai_score: number;
            status: string;
        };

        assert.equal(migratedJob.ai_category, null);
        assert.equal(migratedJob.ai_score, 0);
        assert.equal(migratedJob.status, 'irrelevant');
    } finally {
        database?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

it('marks categories from the previous taxonomy unevaluated for reclassification', () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'lokisjobb-category-migration-'),
    );
    const databasePath = path.join(directory, 'jobs.db');
    let database: Database.Database | undefined;

    try {
        const legacyDatabase = new Database(databasePath);
        legacyDatabase.exec(`
            CREATE TABLE jobs (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                company TEXT,
                location TEXT,
                url TEXT NOT NULL UNIQUE,
                source_url TEXT NOT NULL,
                description TEXT,
                application_deadline TEXT,
                discovered_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                ai_category TEXT,
                status TEXT NOT NULL DEFAULT 'interested'
            );
            INSERT INTO jobs
                (title, url, source_url, discovered_at, last_seen_at, ai_category)
            VALUES
                ('Passenger driver', 'https://example.com/job/1', 'https://example.com/job/1',
                 '2026-01-01', '2026-01-01', 'Lokförare persontåg'),
                ('Other railway job', 'https://example.com/job/2', 'https://example.com/job/2',
                 '2026-01-01', '2026-01-01', 'Potentially interesting railway related job'),
                ('Shunter', 'https://example.com/job/3', 'https://example.com/job/3',
                 '2026-01-01', '2026-01-01', 'Växlare');
        `);
        legacyDatabase.close();

        database = createDatabase(databasePath);
        const categories = database
            .prepare('SELECT ai_category FROM jobs ORDER BY id')
            .all() as Array<{ ai_category: string | null }>;

        assert.deepEqual(categories, [
            { ai_category: null },
            { ai_category: null },
            { ai_category: 'Växlare' },
        ]);
    } finally {
        database?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
