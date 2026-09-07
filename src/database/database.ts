import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const schema = `
  CREATE TABLE IF NOT EXISTS jobs (
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
    ai_score REAL,
    status TEXT NOT NULL DEFAULT 'new'
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

    CREATE TABLE IF NOT EXISTS job_sources (
        job_id INTEGER NOT NULL,
        source_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        availability TEXT NOT NULL DEFAULT 'active',
        checked_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (job_id, source_name, source_url),
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_job_sources_url ON job_sources(source_url);
`;

// Existing local databases may have been created before newer columns existed.
// Keep startup backwards-compatible by adding only missing columns.
function migrateJobsTable(database: Database.Database): void {
    const columns = database.prepare('PRAGMA table_info(jobs)').all() as Array<{
        name: string;
    }>;

    if (!columns.some((column) => column.name === 'application_deadline')) {
        database.exec('ALTER TABLE jobs ADD COLUMN application_deadline TEXT');
    }

    if (!columns.some((column) => column.name === 'source_url')) {
        // Existing rows used url for both purposes. Preserve that value as the
        // source link until a later ingestion discovers a real apply URL.
        database.exec(
            "ALTER TABLE jobs ADD COLUMN source_url TEXT NOT NULL DEFAULT ''",
        );
        database.exec("UPDATE jobs SET source_url = url WHERE source_url = ''");
    }
}

function inferSourceName(sourceUrl: string): string {
    try {
        return new URL(sourceUrl).hostname.replace(/^www\./, '');
    } catch {
        return 'legacy';
    }
}

function migrateJobSources(database: Database.Database): void {
    const columns = database
        .prepare('PRAGMA table_info(job_sources)')
        .all() as Array<{ name: string }>;

    if (!columns.some((column) => column.name === 'availability')) {
        database.exec(
            "ALTER TABLE job_sources ADD COLUMN availability TEXT NOT NULL DEFAULT 'active'",
        );
    }

    if (!columns.some((column) => column.name === 'checked_at')) {
        database.exec(
            "ALTER TABLE job_sources ADD COLUMN checked_at TEXT NOT NULL DEFAULT ''",
        );
        database.exec('UPDATE job_sources SET checked_at = last_seen_at');
    }

    const legacyRows = database
        .prepare(
            "SELECT id, source_url, discovered_at, last_seen_at FROM jobs WHERE source_url <> ''",
        )
        .all() as Array<{
        id: number;
        source_url: string;
        discovered_at: string;
        last_seen_at: string;
    }>;
    const insertSource = database.prepare(
        `INSERT OR IGNORE INTO job_sources
         (job_id, source_name, source_url, first_seen_at, last_seen_at, availability, checked_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    );

    for (const row of legacyRows) {
        insertSource.run(
            row.id,
            inferSourceName(row.source_url),
            row.source_url,
            row.discovered_at,
            row.last_seen_at,
            row.last_seen_at,
        );
    }
}

export function createDatabase(databasePath: string): Database.Database {
    // SQLite does not create parent directories automatically.
    if (databasePath !== ':memory:') {
        fs.mkdirSync(path.dirname(path.resolve(databasePath)), {
            recursive: true,
        });
    }

    const database = new Database(databasePath);
    // This is harmless today, but keeps the database ready for relationships
    // if related tables are introduced later.
    database.pragma('foreign_keys = ON');
    database.exec(schema);
    migrateJobsTable(database);
    migrateJobSources(database);
    return database;
}
