import Database from 'better-sqlite3';
import type {
    Job,
    JobLink,
    AiCategory,
    IngestedJob,
    SourceAvailability,
} from '../types/job.js';
import { isLikelySamePosting } from './job-matching.js';

export type UpsertResult = 'inserted' | 'updated';

type JobRow = {
    id: number;
    title: string;
    company: string | null;
    location: string | null;
    canonical_url: string | null;
    description: string | null;
    application_deadline: string | null;
    discovered_at: string;
    last_seen_at: string;
    ai_category: AiCategory | null;
};

type JobIdentityRow = {
    id: number;
    canonical_url: string | null;
};

type JobMatchDetailsRow = JobIdentityRow & {
    title: string;
    company: string | null;
    location: string | null;
    application_deadline: string | null;
    description: string | null;
};

type SourceRow = {
    provider_name: string;
    link_url: string;
    link_kind: JobLink['kind'];
    first_seen_at: string;
    last_seen_at: string;
    availability: SourceAvailability | null;
    checked_at: string | null;
};

export function transferJobLinks(
    database: Database.Database,
    keepId: number,
    removeId: number,
): void {
    database
        .prepare(
            `INSERT INTO job_links
             SELECT ?, provider_name, link_url, link_kind, first_seen_at,
                    last_seen_at, availability, checked_at
             FROM job_links WHERE job_id = ?
             ON CONFLICT(job_id, provider_name, link_url, link_kind)
             DO UPDATE SET
                 first_seen_at = MIN(job_links.first_seen_at, excluded.first_seen_at),
                 last_seen_at = MAX(job_links.last_seen_at, excluded.last_seen_at),
                 availability = CASE
                     WHEN excluded.checked_at IS NOT NULL
                          AND (job_links.checked_at IS NULL
                               OR excluded.checked_at > job_links.checked_at)
                     THEN excluded.availability
                     ELSE job_links.availability
                 END,
                 checked_at = CASE
                     WHEN excluded.checked_at IS NOT NULL
                          AND (job_links.checked_at IS NULL
                               OR excluded.checked_at > job_links.checked_at)
                     THEN excluded.checked_at
                     ELSE job_links.checked_at
                 END`,
        )
        .run(keepId, removeId);
}

export function mergeJobRows(
    database: Database.Database,
    keepId: number,
    removeId: number,
): void {
    database.transaction(() => {
        transferJobLinks(database, keepId, removeId);
        database.prepare('DELETE FROM jobs WHERE id = ?').run(removeId);
    })();
}

function deriveAvailability(
    links: JobLink[],
    applicationDeadline?: string | null,
): SourceAvailability {
    if (applicationDeadline) {
        const deadlineDate = new Date(applicationDeadline);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        deadlineDate.setHours(0, 0, 0, 0);
        if (!isNaN(deadlineDate.getTime()) && deadlineDate < today) {
            return 'closed';
        }
    }

    const listingLinks = links.filter((link) => link.kind === 'listing');
    if (listingLinks.some((link) => link.availability === 'active')) {
        return 'active';
    }

    if (
        listingLinks.length > 0 &&
        listingLinks.every((link) => link.availability === 'closed')
    ) {
        return 'closed';
    }

    return 'unknown';
}

function toJob(row: JobRow, links: JobLink[]): Job {
    // SQLite uses snake_case columns; the rest of the application uses
    // camelCase TypeScript properties.
    return {
        id: row.id,
        title: row.title,
        company: row.company,
        location: row.location,
        canonicalUrl: row.canonical_url,
        description: row.description,
        applicationDeadline: row.application_deadline,
        discoveredAt: row.discovered_at,
        lastSeenAt: row.last_seen_at,
        aiCategory: row.ai_category,
        links,
        availability: deriveAvailability(links, row.application_deadline),
    };
}

export class JobsRepository {
    public constructor(private readonly database: Database.Database) {}

    public upsert(
        scrapedJob: IngestedJob,
        sourceName: string,
        now = new Date().toISOString(),
    ): UpsertResult {
        const canonicalJob = this.database
            .prepare(
                'SELECT id, canonical_url FROM jobs WHERE canonical_url = ?',
            )
            .get(scrapedJob.canonicalUrl) as JobIdentityRow | undefined;
        const sourceJob = this.database
            .prepare(
                `SELECT id, canonical_url FROM jobs
                 WHERE id IN (
                     SELECT job_id FROM job_links
                     WHERE link_kind = 'listing' AND link_url = ?
                 )
                `,
            )
            .get(scrapedJob.listingUrl) as JobIdentityRow | undefined;

        let existing = canonicalJob ?? sourceJob;
        if (!existing) {
            const candidates = this.database
                .prepare(
                    `SELECT id, title, company, location, application_deadline,
                            description
                     FROM jobs
                     WHERE application_deadline = ?
                       AND company IS NOT NULL
                    `,
                )
                .all(scrapedJob.applicationDeadline) as Array<
                JobMatchDetailsRow & JobIdentityRow
            >;
            const matches = candidates.filter((candidate) =>
                isLikelySamePosting(scrapedJob, {
                    title: candidate.title,
                    company: candidate.company,
                    location: candidate.location,
                    canonicalUrl: candidate.canonical_url,
                    applicationDeadline: candidate.application_deadline,
                    description: candidate.description,
                }),
            );
            if (matches.length === 1) {
                existing = matches[0];
            }
        }

        if (canonicalJob && sourceJob && canonicalJob.id !== sourceJob.id) {
            mergeJobRows(this.database, canonicalJob.id, sourceJob.id);
            existing = canonicalJob;
        }

        if (existing) {
            // Leave discovered_at and ai_category untouched so evaluations
            // survive re-ingestion.
            this.database
                .prepare(
                    `UPDATE jobs
                     SET title = ?, company = COALESCE(company, ?),
                         location = COALESCE(location, ?),
                         canonical_url = COALESCE(?, canonical_url),
                         description = COALESCE(?, description),
                         last_seen_at = ?, application_deadline = ?
                     WHERE id = ?`,
                )
                .run(
                    scrapedJob.title,
                    scrapedJob.company,
                    scrapedJob.location,
                    scrapedJob.canonicalUrl,
                    scrapedJob.description,
                    now,
                    scrapedJob.applicationDeadline,
                    existing.id,
                );
            this.recordLink(
                existing.id,
                sourceName,
                scrapedJob.listingUrl,
                'listing',
                scrapedJob.availability ?? 'active',
                now,
            );
            if (scrapedJob.applicationUrl) {
                this.recordLink(
                    existing.id,
                    sourceName,
                    scrapedJob.applicationUrl,
                    'application',
                    null,
                    now,
                );
            }
            return 'updated';
        }

        const inserted = this.database
            .prepare(
                `INSERT INTO jobs
          (title, company, location, canonical_url, description, application_deadline, discovered_at, last_seen_at, ai_category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            )
            .run(
                scrapedJob.title,
                scrapedJob.company,
                scrapedJob.location,
                scrapedJob.canonicalUrl,
                scrapedJob.description,
                scrapedJob.applicationDeadline,
                now,
                now,
            );

        const jobId = Number(inserted.lastInsertRowid);
        this.recordLink(
            jobId,
            sourceName,
            scrapedJob.listingUrl,
            'listing',
            scrapedJob.availability ?? 'active',
            now,
        );
        if (scrapedJob.applicationUrl) {
            this.recordLink(
                jobId,
                sourceName,
                scrapedJob.applicationUrl,
                'application',
                null,
                now,
            );
        }

        return 'inserted';
    }

    private recordLink(
        jobId: number,
        providerName: string,
        url: string,
        kind: JobLink['kind'],
        availability: SourceAvailability | null,
        now: string,
    ): void {
        this.database
            .prepare(
                `INSERT INTO job_links
                  (job_id, provider_name, link_url, link_kind, first_seen_at, last_seen_at, availability, checked_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(job_id, provider_name, link_url, link_kind)
                  DO UPDATE SET last_seen_at = excluded.last_seen_at,
                             availability = excluded.availability,
                             checked_at = excluded.checked_at`,
            )
            .run(
                jobId,
                providerName,
                url,
                kind,
                now,
                now,
                availability,
                availability === null ? null : now,
            );
    }

    private linksForJob(jobId: number): JobLink[] {
        const rows = this.database
            .prepare(
                `SELECT provider_name, link_url, link_kind, first_seen_at, last_seen_at, availability, checked_at
                 FROM job_links WHERE job_id = ? ORDER BY provider_name, link_kind`,
            )
            .all(jobId) as SourceRow[];
        return rows.map((row) => ({
            provider: row.provider_name,
            url: row.link_url,
            kind: row.link_kind,
            firstSeenAt: row.first_seen_at,
            lastSeenAt: row.last_seen_at,
            availability: row.availability,
            checkedAt: row.checked_at,
        }));
    }

    public findByCanonicalUrl(url: string | null): Job | undefined {
        if (url === null) {
            return undefined;
        }

        const row = this.database
            .prepare('SELECT * FROM jobs WHERE canonical_url = ?')
            .get(url) as JobRow | undefined;
        return row ? toJob(row, this.linksForJob(row.id)) : undefined;
    }

    public list(): Job[] {
        const rows = this.database
            .prepare('SELECT * FROM jobs ORDER BY discovered_at DESC')
            .all() as JobRow[];
        return rows.map((row) => toJob(row, this.linksForJob(row.id)));
    }

    public updateAiCategory(id: number, category: AiCategory): void {
        this.database
            .prepare('UPDATE jobs SET ai_category = ? WHERE id = ?')
            .run(category, id);
    }
}
