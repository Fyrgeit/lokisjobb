import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
    canonicalizeApplicationUrl,
    stripTrackingParameters,
} from '../scraper/ingestion.js';
import { isLikelySamePosting } from './job-matching.js';
import { mergeJobRows, transferJobLinks } from './jobs.js';

const schema = `
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT,
    location TEXT,
    canonical_url TEXT UNIQUE,
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

    ${runHistoryTableSchema('run_history')}
`;

function runHistoryTableSchema(tableName: string): string {
    return `CREATE TABLE IF NOT EXISTS ${tableName} (
        id INTEGER PRIMARY KEY,
        operation TEXT NOT NULL CHECK (operation IN ('fetch', 'ai_classification', 'deployment')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped', 'no_update')),
        summary_json TEXT NOT NULL DEFAULT '{}',
        error_message TEXT
    )`;
}

function migrateRunHistory(database: Database.Database): void {
    const table = database
        .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'run_history'",
        )
        .get() as { sql: string } | undefined;

    if (
        table?.sql.includes("'deployment'") &&
        table.sql.includes("'no_update'")
    ) {
        return;
    }

    database.transaction(() => {
        database.exec(runHistoryTableSchema('run_history_new'));
        database.exec(`
            INSERT INTO run_history_new (
                id, operation, started_at, completed_at, duration_ms,
                status, summary_json, error_message
            )
            SELECT id, operation, started_at, completed_at, duration_ms,
                   status, summary_json, error_message
            FROM run_history
        `);
        database.exec('DROP TABLE run_history');
        database.exec('ALTER TABLE run_history_new RENAME TO run_history');
    })();
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}

function mergeDuplicateJobsByColumn(
    database: Database.Database,
    column: 'canonical_url' | 'source_url',
): void {
    const whereClause =
        column === 'canonical_url'
            ? `${quoteIdentifier(column)} IS NOT NULL`
            : `${quoteIdentifier(column)} <> ''`;
    const groups = database
        .prepare(
            `SELECT ${quoteIdentifier(column)}, COUNT(*) AS cnt
             FROM jobs
             WHERE ${whereClause}
             GROUP BY ${quoteIdentifier(column)}
             HAVING cnt > 1`,
        )
        .all() as Array<Record<typeof column, string>>;

    for (const group of groups) {
        const rows = database
            .prepare(
                `SELECT id FROM jobs
                 WHERE ${quoteIdentifier(column)} = ?
                 ORDER BY discovered_at DESC`,
            )
            .all(group[column]) as Array<{ id: number }>;
        if (rows.length < 2) {
            continue;
        }

        const keepId = rows[0].id;
        for (const duplicate of rows.slice(1)) {
            mergeJobRows(database, keepId, duplicate.id);
        }
    }
}

function makeCanonicalUrlNullable(database: Database.Database): void {
    const columns = database.prepare('PRAGMA table_info(jobs)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
    }>;
    const canonicalUrlColumn = columns.find(
        (column) => column.name === 'canonical_url',
    );
    if (!canonicalUrlColumn?.notnull) {
        return;
    }

    const indexes = database
        .prepare('PRAGMA index_list(jobs)')
        .all() as Array<{
        name: string;
        unique: number;
        origin: string;
    }>;
    const explicitIndexSql = database
        .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobs' AND sql IS NOT NULL",
        )
        .all() as Array<{ sql: string }>;
    const uniqueIndexes = indexes
        .filter((index) => index.unique && index.origin === 'u')
        .map((index, number) => {
            const indexColumns = database
                .prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
                .all() as Array<{ name: string | null }>;
            const names = indexColumns
                .map((column) => column.name)
                .filter((name): name is string => name !== null);
            if (names.length !== indexColumns.length) {
                return null;
            }
            return {
                name: `idx_jobs_nullable_unique_${number}`,
                columns: names.map(quoteIdentifier),
            };
        })
        .filter(
            (
                index,
            ): index is {
                name: string;
                columns: string[];
            } => index !== null,
        );
    const definitions = columns.map((column) => {
        const definition = [
            quoteIdentifier(column.name),
            column.type,
            ...(column.pk ? ['PRIMARY KEY'] : []),
            ...(!column.pk && column.notnull && column.name !== 'canonical_url'
                ? ['NOT NULL']
                : []),
            ...(column.dflt_value !== null
                ? [`DEFAULT ${column.dflt_value}`]
                : []),
        ];
        return definition.join(' ');
    });
    const columnNames = columns
        .map((column) => quoteIdentifier(column.name))
        .join(', ');

    database.pragma('foreign_keys = OFF');
    try {
        database.transaction(() => {
            database.exec(
                `CREATE TABLE jobs_nullable (${definitions.join(', ')})`,
            );
            database.exec(
                `INSERT INTO jobs_nullable (${columnNames})
                 SELECT ${columnNames} FROM jobs`,
            );
            database.exec('DROP TABLE jobs');
            database.exec('ALTER TABLE jobs_nullable RENAME TO jobs');
            for (const index of uniqueIndexes) {
                database.exec(
                    `CREATE UNIQUE INDEX ${quoteIdentifier(index.name)}
                     ON jobs (${index.columns.join(', ')})`,
                );
            }
            for (const index of explicitIndexSql) {
                database.exec(index.sql);
            }
        })();
    } finally {
        database.pragma('foreign_keys = ON');
    }

    const violations = database.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) {
        throw new Error('Jobs table migration left invalid job links');
    }
}

// Existing local databases may have been created before newer columns existed.
// Keep startup backwards-compatible by adding only missing columns.
function migrateJobsTable(database: Database.Database): void {
    let columns = database.prepare('PRAGMA table_info(jobs)').all() as Array<{
        name: string;
    }>;

    const addColumnIfMissing = (
        columnName: string,
        definition: string,
    ): void => {
        if (!columns.some((column) => column.name === columnName)) {
            database.exec(
                `ALTER TABLE jobs ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`,
            );
            columns = database
                .prepare('PRAGMA table_info(jobs)')
                .all() as Array<{ name: string }>;
        }
    };

    if (
        columns.some((column) => column.name === 'url') &&
        !columns.some((column) => column.name === 'canonical_url')
    ) {
        database.exec('ALTER TABLE jobs RENAME COLUMN url TO canonical_url');
        columns = database.prepare('PRAGMA table_info(jobs)').all() as Array<{
            name: string;
        }>;
    }

    addColumnIfMissing('application_deadline', 'TEXT');
    addColumnIfMissing('ai_category', 'TEXT');

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

    makeCanonicalUrlNullable(database);

    // Canonicalize job URLs and merge duplicates
    const jobs = database
        .prepare('SELECT id, canonical_url FROM jobs')
        .all() as Array<{
        id: number;
        canonical_url: string | null;
    }>;
    for (const job of jobs) {
        if (job.canonical_url === null) {
            continue;
        }

        const isListingUrl = database
            .prepare(
                `SELECT 1 FROM job_links
                 WHERE job_id = ? AND link_kind = 'listing' AND link_url = ?`,
            )
            .get(job.id, job.canonical_url);
        const isApplicationUrl = database
            .prepare(
                `SELECT 1 FROM job_links
                 WHERE job_id = ? AND link_kind = 'application' AND link_url = ?`,
            )
            .get(job.id, job.canonical_url);
        if (isListingUrl && !isApplicationUrl) {
            database
                .prepare('UPDATE jobs SET canonical_url = NULL WHERE id = ?')
                .run(job.id);
            continue;
        }

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

        if (
            isApplicationUrl &&
            !['http:', 'https:'].includes(new URL(canonicalUrl).protocol)
        ) {
            database
                .prepare('UPDATE jobs SET canonical_url = NULL WHERE id = ?')
                .run(job.id);
            continue;
        }

        if (canonicalUrl !== job.canonical_url) {
            const existing = database
                .prepare(
                    'SELECT id FROM jobs WHERE canonical_url = ? AND id <> ?',
                )
                .get(canonicalUrl, job.id) as { id: number } | undefined;
            if (existing) {
                mergeJobRows(database, existing.id, job.id);
            } else {
                database
                    .prepare('UPDATE jobs SET canonical_url = ? WHERE id = ?')
                    .run(canonicalUrl, job.id);
            }
        }
    }

    // Merge any duplicate jobs that have the same canonical URL.
    mergeDuplicateJobsByColumn(database, 'canonical_url');

    const sourceUrlColumnExists = columns.some(
        (column) => column.name === 'source_url',
    );
    if (sourceUrlColumnExists) {
        mergeDuplicateJobsByColumn(database, 'source_url');
        database.exec('ALTER TABLE jobs DROP COLUMN source_url');
    }

    mergeLikelyDuplicateJobs(database);
}

function mergeLikelyDuplicateJobs(database: Database.Database): void {
    const jobs = database
        .prepare(
            `SELECT id, title, company, canonical_url, description,
                    application_deadline, last_seen_at, ai_category
             FROM jobs ORDER BY discovered_at, id`,
        )
        .all() as Array<{
        id: number;
        title: string;
        company: string | null;
        canonical_url: string | null;
        description: string | null;
        application_deadline: string | null;
        last_seen_at: string;
        ai_category: string | null;
    }>;
    const removedIds = new Set<number>();

    for (let index = 0; index < jobs.length; index += 1) {
        const keep = jobs[index];
        if (!keep || removedIds.has(keep.id)) {
            continue;
        }

        const cluster = [keep];
        for (const candidate of jobs.slice(index + 1)) {
            if (
                removedIds.has(candidate.id) ||
                !cluster.every((member) =>
                    isLikelySamePosting(
                        {
                            title: member.title,
                            company: member.company,
                            canonicalUrl: member.canonical_url,
                            applicationDeadline: member.application_deadline,
                            description: member.description,
                        },
                        {
                            title: candidate.title,
                            company: candidate.company,
                            canonicalUrl: candidate.canonical_url,
                            applicationDeadline: candidate.application_deadline,
                            description: candidate.description,
                        },
                    ),
                )
            ) {
                continue;
            }
            cluster.push(candidate);
        }

        for (const duplicate of cluster.slice(1)) {
            database.transaction(() => {
                transferJobLinks(database, keep.id, duplicate.id);
                database
                    .prepare(
                        `UPDATE jobs
                         SET canonical_url = COALESCE(canonical_url, ?),
                             description = COALESCE(description, ?),
                             application_deadline = COALESCE(application_deadline, ?),
                             last_seen_at = MAX(last_seen_at, ?),
                                 ai_category = COALESCE(ai_category, ?)
                         WHERE id = ?`,
                    )
                    .run(
                        duplicate.canonical_url,
                        duplicate.description,
                        duplicate.application_deadline,
                        duplicate.last_seen_at,
                        duplicate.ai_category,
                        keep.id,
                    );
                database
                    .prepare('DELETE FROM jobs WHERE id = ?')
                    .run(duplicate.id);
            })();
            removedIds.add(duplicate.id);
        }
    }
}

function normalizeApplicationLinks(database: Database.Database): void {
    const links = database
        .prepare(
            `SELECT job_id, provider_name, link_url, first_seen_at,
                    last_seen_at, availability, checked_at
             FROM job_links WHERE link_kind = 'application'`,
        )
        .all() as Array<{
        job_id: number;
        provider_name: string;
        link_url: string;
        first_seen_at: string;
        last_seen_at: string;
        availability: string | null;
        checked_at: string | null;
    }>;

    const insertNormalizedLink = database.prepare(
        `INSERT INTO job_links
         (job_id, provider_name, link_url, link_kind, first_seen_at,
          last_seen_at, availability, checked_at)
         VALUES (?, ?, ?, 'application', ?, ?, ?, ?)
         ON CONFLICT(job_id, provider_name, link_url, link_kind)
         DO UPDATE SET
             first_seen_at = MIN(job_links.first_seen_at, excluded.first_seen_at),
             last_seen_at = MAX(job_links.last_seen_at, excluded.last_seen_at),
             checked_at = CASE
                 WHEN excluded.checked_at IS NOT NULL
                      AND (job_links.checked_at IS NULL
                           OR excluded.checked_at > job_links.checked_at)
                 THEN excluded.checked_at
                 ELSE job_links.checked_at
             END`,
    );
    const deleteOriginalLink = database.prepare(
        `DELETE FROM job_links
         WHERE job_id = ? AND provider_name = ?
           AND link_url = ? AND link_kind = 'application'`,
    );

    for (const link of links) {
        let normalizedUrl: string;
        try {
            normalizedUrl = stripTrackingParameters(link.link_url);
        } catch (error: unknown) {
            if (!(error instanceof TypeError)) {
                throw error;
            }
            console.warn(
                `Skipping application URL cleanup for job #${link.job_id}: invalid URL`,
            );
            continue;
        }

        if (normalizedUrl === link.link_url) {
            continue;
        }

        database.transaction(() => {
            insertNormalizedLink.run(
                link.job_id,
                link.provider_name,
                normalizedUrl,
                link.first_seen_at,
                link.last_seen_at,
                link.availability,
                link.checked_at,
            );
            deleteOriginalLink.run(
                link.job_id,
                link.provider_name,
                link.link_url,
            );
        })();
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
        migrateRunHistory(database);
        migrateJobLinks(database);
        migrateJobsTable(database);
        normalizeApplicationLinks(database);
        return database;
    } catch (error: unknown) {
        database.close();
        throw error;
    }
}

export async function withDatabase<T>(
    databasePath: string,
    operation: (database: Database.Database) => T | Promise<T>,
): Promise<T> {
    const database = createDatabase(databasePath);
    try {
        return await operation(database);
    } finally {
        database.close();
    }
}
