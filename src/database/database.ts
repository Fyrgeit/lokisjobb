import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { canonicalizeApplicationUrl } from '../scraper/ingestion.js';

const schema = `
  CREATE TABLE IF NOT EXISTS jobs (
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

    CREATE TABLE IF NOT EXISTS job_links (
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

    CREATE INDEX IF NOT EXISTS idx_job_links_url ON job_links(link_url);
`;

// Existing local databases may have been created before newer columns existed.
// Keep startup backwards-compatible by adding only missing columns.
function migrateJobsTable(database: Database.Database): void {
    let columns = database.prepare('PRAGMA table_info(jobs)').all() as Array<{
        name: string;
    }>;

    if (
        columns.some((column) => column.name === 'url') &&
        !columns.some((column) => column.name === 'canonical_url')
    ) {
        database.exec('ALTER TABLE jobs RENAME COLUMN url TO canonical_url');
        columns = database.prepare('PRAGMA table_info(jobs)').all() as Array<{
            name: string;
        }>;
    }

    if (!columns.some((column) => column.name === 'application_deadline')) {
        database.exec('ALTER TABLE jobs ADD COLUMN application_deadline TEXT');
    }

    if (!columns.some((column) => column.name === 'ai_category')) {
        database.exec('ALTER TABLE jobs ADD COLUMN ai_category TEXT');
    }

    database.exec(`
        UPDATE jobs
        SET ai_category = NULL
        WHERE ai_category IN (
            'Lokförare persontåg',
            'Lokförare godståg',
            'Potentially interesting railway related job',
            'Not interesting'
        )
    `);

    if (columns.some((column) => column.name === 'status')) {
        database.exec('DROP INDEX IF EXISTS idx_jobs_status');
        database.exec('ALTER TABLE jobs DROP COLUMN status');
    }

    // Canonicalize job URLs and merge duplicates
    const jobs = database
        .prepare('SELECT id, canonical_url FROM jobs')
        .all() as Array<{
        id: number;
        canonical_url: string;
    }>;
    for (const job of jobs) {
        let canonicalUrl: string;
        try {
            canonicalUrl = canonicalizeApplicationUrl(job.canonical_url);
        } catch (error: unknown) {
            if (!(error instanceof TypeError)) {
                throw error;
            }
            console.warn(
                `Skipping URL canonicalization for job #${job.id}: invalid URL`,
            );
            continue;
        }

        if (canonicalUrl !== job.canonical_url) {
            const existing = database
                .prepare(
                    'SELECT id FROM jobs WHERE canonical_url = ? AND id <> ?',
                )
                .get(canonicalUrl, job.id) as { id: number } | undefined;
            if (existing) {
                database.transaction(() => {
                    database
                        .prepare(
                            `
                            INSERT OR IGNORE INTO job_links
                            SELECT ?, provider_name, link_url, link_kind, first_seen_at, last_seen_at, availability, checked_at
                            FROM job_links WHERE job_id = ?
                        `,
                        )
                        .run(existing.id, job.id);
                    database
                        .prepare('DELETE FROM jobs WHERE id = ?')
                        .run(job.id);
                })();
            } else {
                database
                    .prepare('UPDATE jobs SET canonical_url = ? WHERE id = ?')
                    .run(canonicalUrl, job.id);
            }
        }
    }

    // Merge any duplicate jobs that have the same canonical URL.
    const urlDuplicateGroups = database
        .prepare(
            `
        SELECT canonical_url, COUNT(*) as cnt FROM jobs
        GROUP BY canonical_url HAVING cnt > 1
    `,
        )
        .all() as Array<{ canonical_url: string }>;

    for (const group of urlDuplicateGroups) {
        const rows = database
            .prepare(
                'SELECT id FROM jobs WHERE canonical_url = ? ORDER BY discovered_at DESC',
            )
            .all(group.canonical_url) as Array<{ id: number }>;
        if (rows.length > 1) {
            const keepId = rows[0].id;
            const duplicateIds = rows.slice(1).map((r) => r.id);

            database.transaction(() => {
                for (const dupId of duplicateIds) {
                    database
                        .prepare(
                            `
                        INSERT OR IGNORE INTO job_links
                        SELECT ?, provider_name, link_url, link_kind, first_seen_at, last_seen_at, availability, checked_at
                        FROM job_links WHERE job_id = ?
                    `,
                        )
                        .run(keepId, dupId);
                    database
                        .prepare('DELETE FROM jobs WHERE id = ?')
                        .run(dupId);
                }
            })();
        }
    }

    const sourceUrlColumnExists = columns.some(
        (column) => column.name === 'source_url',
    );
    if (sourceUrlColumnExists) {
        const sourceDuplicateGroups = database
            .prepare(
                `SELECT source_url, COUNT(*) as cnt FROM jobs
                 WHERE source_url <> '' GROUP BY source_url HAVING cnt > 1`,
            )
            .all() as Array<{ source_url: string }>;

        for (const group of sourceDuplicateGroups) {
            const rows = database
                .prepare(
                    'SELECT id FROM jobs WHERE source_url = ? ORDER BY discovered_at DESC',
                )
                .all(group.source_url) as Array<{ id: number }>;
            if (rows.length > 1) {
                const keepId = rows[0].id;
                const duplicateIds = rows.slice(1).map((r) => r.id);

                database.transaction(() => {
                    for (const dupId of duplicateIds) {
                        database
                            .prepare(
                                `INSERT OR IGNORE INTO job_links
                                 SELECT ?, provider_name, link_url, link_kind, first_seen_at, last_seen_at, availability, checked_at
                                 FROM job_links WHERE job_id = ?`,
                            )
                            .run(keepId, dupId);
                        database
                            .prepare('DELETE FROM jobs WHERE id = ?')
                            .run(dupId);
                    }
                })();
            }
        }
        database.exec('ALTER TABLE jobs DROP COLUMN source_url');
    }
}

function inferSourceName(sourceUrl: string, jobId: number): string {
    try {
        return new URL(sourceUrl).hostname.replace(/^www\./, '');
    } catch (error: unknown) {
        if (!(error instanceof TypeError)) {
            throw error;
        }
        console.warn(
            `Using legacy source name for job #${jobId}: invalid source URL`,
        );
        return 'legacy';
    }
}

function migrateJobLinks(database: Database.Database): void {
    const legacyTable = database
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'job_sources'",
        )
        .get();
    if (legacyTable) {
        const columns = database
            .prepare('PRAGMA table_info(job_sources)')
            .all() as Array<{ name: string }>;
        const columnNames = new Set(columns.map((column) => column.name));
        const availability = columnNames.has('availability')
            ? 'availability'
            : "'active'";
        const checkedAt = columnNames.has('checked_at')
            ? 'checked_at'
            : 'last_seen_at';

        database.exec(`
            INSERT OR IGNORE INTO job_links
                (job_id, provider_name, link_url, link_kind, first_seen_at,
                 last_seen_at, availability, checked_at)
            SELECT job_id, source_name, source_url, 'listing', first_seen_at,
                   last_seen_at, ${availability}, ${checkedAt}
            FROM job_sources
        `);
    }

    const jobColumns = database
        .prepare('PRAGMA table_info(jobs)')
        .all() as Array<{ name: string }>;
    if (jobColumns.some((column) => column.name === 'source_url')) {
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
        const insertLink = database.prepare(
            `INSERT OR IGNORE INTO job_links
             (job_id, provider_name, link_url, link_kind, first_seen_at,
              last_seen_at, availability, checked_at)
             VALUES (?, ?, ?, 'listing', ?, ?, 'active', ?)`,
        );

        for (const row of legacyRows) {
            const existingListing = database
                .prepare(
                    `SELECT 1 FROM job_links
                     WHERE job_id = ? AND link_url = ? AND link_kind = 'listing'`,
                )
                .get(row.id, row.source_url);
            if (existingListing) {
                continue;
            }

            insertLink.run(
                row.id,
                inferSourceName(row.source_url, row.id),
                row.source_url,
                row.discovered_at,
                row.last_seen_at,
                row.last_seen_at,
            );
        }
    }

    if (legacyTable) {
        database.exec('DROP TABLE job_sources');
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
    try {
        // Link rows depend on their owning job rows.
        database.pragma('foreign_keys = ON');
        database.exec(schema);
        migrateJobLinks(database);
        migrateJobsTable(database);
        return database;
    } catch (error: unknown) {
        database.close();
        throw error;
    }
}
