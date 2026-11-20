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
            CREATE INDEX idx_jobs_status ON jobs(status);
            INSERT INTO jobs
                (title, url, discovered_at, last_seen_at, ai_score, status)
            VALUES
                ('Truck driver', 'https://example.com/job/1',
                 '2026-01-01', '2026-01-01', 0, 'interested');
        `);
        legacyDatabase.close();

        database = createDatabase(databasePath);
        const migratedJob = database
            .prepare('SELECT ai_category, ai_score FROM jobs WHERE id = 1')
            .get() as {
            ai_category: string | null;
            ai_score: number;
        };

        assert.equal(migratedJob.ai_category, null);
        assert.equal(migratedJob.ai_score, 0);
        const columns = database
            .prepare('PRAGMA table_info(jobs)')
            .all() as Array<{ name: string }>;
        assert.equal(columns.some((column) => column.name === 'status'), false);
        const statusIndex = database
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_jobs_status'",
            )
            .get();
        assert.equal(statusIndex, undefined);
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
        const columns = database
            .prepare('PRAGMA table_info(jobs)')
            .all() as Array<{ name: string }>;
        assert.equal(columns.some((column) => column.name === 'status'), false);
    } finally {
        database?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

it('preserves legacy jobs with invalid URLs and warns during migration', () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'lokisjobb-invalid-url-migration-'),
    );
    const databasePath = path.join(directory, 'jobs.db');
    let database: Database.Database | undefined;
    const originalWarn = console.warn;
    const warnings: string[] = [];

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
                ai_category TEXT
            );
            INSERT INTO jobs
                (title, url, source_url, discovered_at, last_seen_at)
            VALUES
                ('Legacy job', 'not a URL', 'not a source URL', '2026-01-01', '2026-01-01');
        `);
        legacyDatabase.close();
        console.warn = (message?: unknown) => warnings.push(String(message));

        database = createDatabase(databasePath);

        const job = database
            .prepare('SELECT canonical_url FROM jobs WHERE id = 1')
            .get() as { canonical_url: string };
        assert.equal(job.canonical_url, 'not a URL');
        assert.deepEqual(warnings, [
            'Using legacy source name for job #1: invalid source URL',
            'Skipping URL canonicalization for job #1: invalid URL',
        ]);
    } finally {
        console.warn = originalWarn;
        database?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

it('migrates source records into typed job links without losing their metadata', () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'lokisjobb-links-migration-'),
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
                ai_category TEXT
            );
            CREATE TABLE job_sources (
                job_id INTEGER NOT NULL,
                source_name TEXT NOT NULL,
                source_url TEXT NOT NULL,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                availability TEXT NOT NULL DEFAULT 'active',
                checked_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (job_id, source_name, source_url)
            );
            INSERT INTO jobs
                (id, title, url, source_url, discovered_at, last_seen_at)
            VALUES
                (1, 'Rail driver', 'https://apply.example/job/1',
                 'https://board.example/job/1', '2026-01-01', '2026-01-02');
            INSERT INTO job_sources
                (job_id, source_name, source_url, first_seen_at, last_seen_at,
                 availability, checked_at)
            VALUES
                (1, 'legacy-provider', 'https://board.example/job/1',
                 '2026-01-01', '2026-01-02', 'closed', '2026-01-02');
        `);
        legacyDatabase.close();

        database = createDatabase(databasePath);
        const links = database
            .prepare(
                'SELECT provider_name, link_url, link_kind, availability, checked_at FROM job_links ORDER BY link_url',
            )
            .all();

        assert.deepEqual(
            database
                .prepare('SELECT canonical_url FROM jobs WHERE id = 1')
                .get(),
            { canonical_url: 'https://apply.example/job/1' },
        );
        assert.deepEqual(links, [
            {
                provider_name: 'legacy-provider',
                link_url: 'https://board.example/job/1',
                link_kind: 'listing',
                availability: 'closed',
                checked_at: '2026-01-02',
            },
        ]);
        const jobColumns = database
            .prepare('PRAGMA table_info(jobs)')
            .all() as Array<{ name: string }>;
        assert.equal(
            jobColumns.some((column) => column.name === 'canonical_url'),
            true,
        );
        assert.equal(jobColumns.some((column) => column.name === 'url'), false);
        assert.equal(
            jobColumns.some((column) => column.name === 'source_url'),
            false,
        );
        assert.equal(
            database
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'job_sources'",
                )
                .get(),
            undefined,
        );
    } finally {
        database?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

it('makes legacy listing URLs optional and merges matching source records', () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'lokisjobb-deduplication-migration-'),
    );
    const databasePath = path.join(directory, 'jobs.db');
    let database: Database.Database | undefined;

    try {
        const description =
            'SHN Cargo Sverige AB söker lokförare till stationeringsort Falköping. Du genomför säkra och effektiva godstransporter och samarbetar med kollegor. Vi söker dig med lokförarbevis, yrkeserfarenhet och högt säkerhetstänkande. Heltid med varierande tjänstgöring enligt 5/2-schema. Sista ansökningsdag är 15 december 2026.';
        const legacyDatabase = new Database(databasePath);
        legacyDatabase.exec(`
            CREATE TABLE jobs (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                company TEXT,
                location TEXT,
                canonical_url TEXT NOT NULL UNIQUE,
                description TEXT,
                application_deadline TEXT,
                discovered_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                ai_category TEXT
            );
            CREATE TABLE job_links (
                job_id INTEGER NOT NULL,
                provider_name TEXT NOT NULL,
                link_url TEXT NOT NULL,
                link_kind TEXT NOT NULL,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                availability TEXT,
                checked_at TEXT,
                PRIMARY KEY (job_id, provider_name, link_url, link_kind),
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
            );
            INSERT INTO jobs
                (id, title, company, location, canonical_url, description,
                 application_deadline, discovered_at, last_seen_at)
            VALUES
                (1, 'Lokförare till SHN Cargo', 'SHN Cargo AB', NULL,
                 'https://arbetsformedlingen.se/platsbanken/annonser/31714391',
                 '${description}', '2026-12-15', '2026-11-12T10:00:00.000Z',
                 '2026-11-20T09:00:00.000Z'),
                (2, 'Lokförare till SHN Cargo', 'SHN Cargo AB',
                 'De nordiska länderna',
                 'https://jobbland.se/jobb/lokforare-till-shn-cargo-sasrb-20725653',
                 '${description} Lön enligt överenskommelse.',
                 '2026-12-15', '2026-11-12T11:00:00.000Z',
                 '2026-11-12T11:00:00.000Z');
            INSERT INTO job_links
                (job_id, provider_name, link_url, link_kind, first_seen_at,
                 last_seen_at, availability, checked_at)
            VALUES
                (1, 'arbetsformedlingen.se',
                 'https://arbetsformedlingen.se/platsbanken/annonser/31714391',
                 'listing', '2026-11-12', '2026-11-20', 'active', '2026-11-20'),
                (2, 'jobbland.se',
                 'https://jobbland.se/jobb/lokforare-till-shn-cargo-sasrb-20725653',
                 'listing', '2026-11-12', '2026-11-12', 'active', '2026-11-12');
        `);
        legacyDatabase.close();

        database = createDatabase(databasePath);
        const jobs = database
            .prepare('SELECT id, canonical_url FROM jobs')
            .all();
        const links = database
            .prepare(
                'SELECT provider_name, link_url FROM job_links ORDER BY provider_name',
            )
            .all();
        const canonicalColumn = (
            database.prepare('PRAGMA table_info(jobs)').all() as Array<{
                name: string;
                notnull: number;
            }>
        ).find((column) => column.name === 'canonical_url');

        assert.deepEqual(jobs, [{ id: 1, canonical_url: null }]);
        assert.deepEqual(links, [
            {
                provider_name: 'arbetsformedlingen.se',
                link_url:
                    'https://arbetsformedlingen.se/platsbanken/annonser/31714391',
            },
            {
                provider_name: 'jobbland.se',
                link_url:
                    'https://jobbland.se/jobb/lokforare-till-shn-cargo-sasrb-20725653',
            },
        ]);
        assert.equal(canonicalColumn?.notnull, 0);
    } finally {
        database?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
