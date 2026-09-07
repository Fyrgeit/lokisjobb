import Database from 'better-sqlite3';
import type {
    Job,
    JobSourceRecord,
    JobStatus,
    ScrapedJob,
    SourceAvailability,
} from '../types/job.js';

export type UpsertResult = 'inserted' | 'updated';

type JobRow = {
    id: number;
    title: string;
    company: string | null;
    location: string | null;
    url: string;
    description: string | null;
    application_deadline: string | null;
    discovered_at: string;
    last_seen_at: string;
    ai_score: number | null;
    status: JobStatus;
};

type SourceRow = {
    source_name: string;
    source_url: string;
    first_seen_at: string;
    last_seen_at: string;
    availability: SourceAvailability;
    checked_at: string;
};

function deriveAvailability(sources: JobSourceRecord[]): SourceAvailability {
    if (sources.some((source) => source.availability === 'active')) {
        return 'active';
    }

    if (
        sources.length > 0 &&
        sources.every((source) => source.availability === 'closed')
    ) {
        return 'closed';
    }

    return 'unknown';
}

function toJob(row: JobRow, sources: JobSourceRecord[]): Job {
    // SQLite uses snake_case columns; the rest of the application uses
    // camelCase TypeScript properties.
    return {
        id: row.id,
        title: row.title,
        company: row.company,
        location: row.location,
        url: row.url,
        description: row.description,
        applicationDeadline: row.application_deadline,
        discoveredAt: row.discovered_at,
        lastSeenAt: row.last_seen_at,
        aiScore: row.ai_score,
        status: row.status,
        sources,
        availability: deriveAvailability(sources),
    };
}

export class JobsRepository {
    public constructor(private readonly database: Database.Database) {}

    public upsert(
        scrapedJob: ScrapedJob,
        sourceName: string,
        now = new Date().toISOString(),
    ): UpsertResult {
        // URL is the stable identity for a listing. It prevents the same job
        // from being inserted again when a later search sees it.
        const canonicalJob = this.database
            .prepare('SELECT id FROM jobs WHERE url = ?')
            .get(scrapedJob.url) as { id: number } | undefined;
        const sourceJob = this.database
            .prepare(
                `SELECT id FROM jobs
                 WHERE source_url = ? AND url <> ?
                    OR id IN (SELECT job_id FROM job_sources WHERE source_url = ?)
                       AND url <> ?`,
            )
            .get(
                scrapedJob.sourceUrl,
                scrapedJob.url,
                scrapedJob.sourceUrl,
                scrapedJob.url,
            ) as { id: number } | undefined;

        // A previous ingestion may have stored the source page as the URL.
        // Once a canonical application URL is known, discard that duplicate
        // row and keep the canonical row as the job's identity.
        if (canonicalJob && sourceJob) {
            this.database.transaction(() => {
                this.database
                    .prepare(
                        `INSERT OR IGNORE INTO job_sources
                         SELECT ?, source_name, source_url, first_seen_at, last_seen_at, availability, checked_at
                         FROM job_sources WHERE job_id = ?`,
                    )
                    .run(canonicalJob.id, sourceJob.id);
                this.database
                    .prepare('DELETE FROM jobs WHERE id = ?')
                    .run(sourceJob.id);
            })();
        }

        const existing = canonicalJob ?? sourceJob;

        if (existing) {
            // Refresh source-owned fields, but leave discovered_at, status, and
            // ai_score untouched so local decisions survive re-ingestion.
            this.database
                .prepare(
                    'UPDATE jobs SET url = ?, description = ?, source_url = ?, last_seen_at = ?, application_deadline = ? WHERE id = ?',
                )
                .run(
                    scrapedJob.url,
                    scrapedJob.description,
                    scrapedJob.sourceUrl,
                    now,
                    scrapedJob.applicationDeadline,
                    existing.id,
                );
            this.recordSource(
                existing.id,
                sourceName,
                scrapedJob.sourceUrl,
                scrapedJob.availability ?? 'active',
                now,
            );
            return 'updated';
        }

        // New jobs start with local defaults. The evaluator can fill ai_score
        // later without changing the source or ingestion layers.
        this.database
            .prepare(
                `INSERT INTO jobs
          (title, company, location, url, source_url, description, application_deadline, discovered_at, last_seen_at, ai_score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'new')`,
            )
            .run(
                scrapedJob.title,
                scrapedJob.company,
                scrapedJob.location,
                scrapedJob.url,
                scrapedJob.sourceUrl,
                scrapedJob.description,
                scrapedJob.applicationDeadline,
                now,
                now,
            );

        const inserted = this.database
            .prepare('SELECT id FROM jobs WHERE url = ?')
            .get(scrapedJob.url) as { id: number };
        this.recordSource(
            inserted.id,
            sourceName,
            scrapedJob.sourceUrl,
            scrapedJob.availability ?? 'active',
            now,
        );

        return 'inserted';
    }

    private recordSource(
        jobId: number,
        sourceName: string,
        sourceUrl: string,
        availability: SourceAvailability,
        now: string,
    ): void {
        this.database
            .prepare(
                `INSERT INTO job_sources
                  (job_id, source_name, source_url, first_seen_at, last_seen_at, availability, checked_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(job_id, source_name, source_url)
                  DO UPDATE SET last_seen_at = excluded.last_seen_at,
                             availability = excluded.availability,
                             checked_at = excluded.checked_at`,
            )
            .run(jobId, sourceName, sourceUrl, now, now, availability, now);
    }

    private sourcesForJob(jobId: number): JobSourceRecord[] {
        const rows = this.database
            .prepare(
                `SELECT source_name, source_url, first_seen_at, last_seen_at, availability, checked_at
                 FROM job_sources WHERE job_id = ? ORDER BY source_name`,
            )
            .all(jobId) as SourceRow[];
        return rows.map((row) => ({
            name: row.source_name,
            url: row.source_url,
            firstSeenAt: row.first_seen_at,
            lastSeenAt: row.last_seen_at,
            availability: row.availability,
            checkedAt: row.checked_at,
        }));
    }

    public findByUrl(url: string): Job | undefined {
        const row = this.database
            .prepare('SELECT * FROM jobs WHERE url = ?')
            .get(url) as JobRow | undefined;
        return row ? toJob(row, this.sourcesForJob(row.id)) : undefined;
    }

    public list(): Job[] {
        const rows = this.database
            .prepare('SELECT * FROM jobs ORDER BY discovered_at DESC')
            .all() as JobRow[];
        return rows.map((row) => toJob(row, this.sourcesForJob(row.id)));
    }

    public updateAiScore(id: number, aiScore: number | null): void {
        this.database
            .prepare('UPDATE jobs SET ai_score = ? WHERE id = ?')
            .run(aiScore, id);
    }

    public updateStatus(id: number, status: JobStatus): void {
        this.database
            .prepare('UPDATE jobs SET status = ? WHERE id = ?')
            .run(status, id);
    }
}
