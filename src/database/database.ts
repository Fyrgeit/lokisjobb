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
    return database;
}
