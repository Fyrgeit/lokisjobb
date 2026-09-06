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
    description TEXT,
    discovered_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ai_score REAL,
    status TEXT NOT NULL DEFAULT 'new'
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`;

export function createDatabase(databasePath: string): Database.Database {
    if (databasePath !== ':memory:') {
        fs.mkdirSync(path.dirname(path.resolve(databasePath)), {
            recursive: true,
        });
    }

    const database = new Database(databasePath);
    database.pragma('foreign_keys = ON');
    database.exec(schema);
    return database;
}
