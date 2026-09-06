import Database from 'better-sqlite3';
import type { Job, JobStatus, ScrapedJob } from '../types/job.js';

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

function toJob(row: JobRow): Job {
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
    };
}

export class JobsRepository {
    public constructor(private readonly database: Database.Database) {}

    public upsert(
        scrapedJob: ScrapedJob,
        now = new Date().toISOString(),
    ): UpsertResult {
        // URL is the stable identity for a listing. It prevents the same job
        // from being inserted again when a later search sees it.
        const existing = this.database
            .prepare('SELECT id FROM jobs WHERE url = ?')
            .get(scrapedJob.url) as { id: number } | undefined;

        if (existing) {
            // Refresh source-owned fields, but leave discovered_at, status, and
            // ai_score untouched so local decisions survive re-ingestion.
            this.database
                .prepare(
                    'UPDATE jobs SET description = ?, last_seen_at = ?, application_deadline = ? WHERE id = ?',
                )
                .run(
                    scrapedJob.description,
                    now,
                    scrapedJob.applicationDeadline,
                    existing.id,
                );
            return 'updated';
        }

        // New jobs start with local defaults. The evaluator can fill ai_score
        // later without changing the source or ingestion layers.
        this.database
            .prepare(
                `INSERT INTO jobs
          (title, company, location, url, description, application_deadline, discovered_at, last_seen_at, ai_score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'new')`,
            )
            .run(
                scrapedJob.title,
                scrapedJob.company,
                scrapedJob.location,
                scrapedJob.url,
                scrapedJob.description,
                scrapedJob.applicationDeadline,
                now,
                now,
            );

        return 'inserted';
    }

    public findByUrl(url: string): Job | undefined {
        const row = this.database
            .prepare('SELECT * FROM jobs WHERE url = ?')
            .get(url) as JobRow | undefined;
        return row ? toJob(row) : undefined;
    }

    public list(): Job[] {
        const rows = this.database
            .prepare('SELECT * FROM jobs ORDER BY discovered_at DESC')
            .all() as JobRow[];
        return rows.map(toJob);
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
