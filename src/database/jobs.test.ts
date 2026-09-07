import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createDatabase } from './database.js';
import { JobsRepository } from './jobs.js';
import type { ScrapedJob } from '../types/job.js';

const databases: ReturnType<typeof createDatabase>[] = [];

function createRepository(): JobsRepository {
    // Each test gets an isolated database, so tests never depend on the local
    // data/jobs.db file or on the order in which tests run.
    const database = createDatabase(':memory:');
    databases.push(database);
    return new JobsRepository(database);
}

const scrapedJob: ScrapedJob = {
    title: 'Lokförare',
    company: 'Nordic Rail AB',
    location: 'Stockholm',
    url: 'https://example.com/jobs/driver',
    sourceUrl: 'https://example.com/jobs/driver',
    description: 'Kör tåg i regional trafik.',
    applicationDeadline: '2026-01-15',
};

afterEach(() => {
    for (const database of databases.splice(0)) {
        database.close();
    }
});

describe('JobsRepository.upsert', () => {
    it('inserts a new job with initial state', () => {
        const repository = createRepository();
        const result = repository.upsert(
            scrapedJob,
            'test-source',
            '2026-01-01T10:00:00.000Z',
        );
        const job = repository.findByUrl(scrapedJob.url);

        assert.equal(result, 'inserted');
        assert.equal(repository.list().length, 1);
        assert.equal(job?.discoveredAt, '2026-01-01T10:00:00.000Z');
        assert.equal(job?.lastSeenAt, '2026-01-01T10:00:00.000Z');
        assert.equal(job?.status, 'new');
        assert.equal(job?.aiScore, null);
        assert.equal(job?.applicationDeadline, '2026-01-15');
        assert.deepEqual(job?.sources, [
            {
                name: 'test-source',
                url: scrapedJob.sourceUrl,
                firstSeenAt: '2026-01-01T10:00:00.000Z',
                lastSeenAt: '2026-01-01T10:00:00.000Z',
                availability: 'active',
                checkedAt: '2026-01-01T10:00:00.000Z',
            },
        ]);
    });

    it('updates only last_seen_at for an existing URL', () => {
        const repository = createRepository();
        repository.upsert(
            scrapedJob,
            'first-source',
            '2026-01-01T10:00:00.000Z',
        );
        const firstJob = repository.findByUrl(scrapedJob.url);
        assert.ok(firstJob);
        repository.updateStatus(firstJob.id, 'interested');
        repository.updateAiScore(firstJob.id, 0.85);

        // These values represent local decisions and must survive a source
        // refresh even though source-owned fields are updated.
        const result = repository.upsert(
            { ...scrapedJob, title: 'Updated title from source' },
            'first-source',
            '2026-01-02T10:00:00.000Z',
        );
        const job = repository.findByUrl(scrapedJob.url);

        assert.equal(result, 'updated');
        assert.equal(repository.list().length, 1);
        assert.equal(job?.discoveredAt, '2026-01-01T10:00:00.000Z');
        assert.equal(job?.lastSeenAt, '2026-01-02T10:00:00.000Z');
        assert.equal(job?.title, 'Lokförare');
        assert.equal(job?.status, 'interested');
        assert.equal(job?.aiScore, 0.85);
    });

    it('removes an older source row when a canonical duplicate is found', () => {
        const repository = createRepository();
        const canonicalUrl = 'https://emp.jobylon.com/jobs/380014';
        const firstSourceUrl =
            'https://jarnvagsjobb.se/lediga-jobb/green-cargo/';
        const secondSourceUrl = 'https://jobbland.se/jobb/green-cargo-20548873';

        repository.upsert(
            { ...scrapedJob, url: canonicalUrl, sourceUrl: firstSourceUrl },
            'jarnvagsjobb.se',
            '2026-01-01T10:00:00.000Z',
        );
        repository.upsert(
            { ...scrapedJob, url: secondSourceUrl, sourceUrl: secondSourceUrl },
            'jobbland.se',
            '2026-01-01T10:00:00.000Z',
        );
        repository.upsert(
            { ...scrapedJob, url: canonicalUrl, sourceUrl: secondSourceUrl },
            'jobbland.se',
            '2026-01-02T10:00:00.000Z',
        );

        assert.equal(repository.list().length, 1);
        assert.equal(
            repository.findByUrl(canonicalUrl)?.lastSeenAt,
            '2026-01-02T10:00:00.000Z',
        );
        assert.equal(repository.findByUrl(canonicalUrl)?.sources.length, 2);
    });

    it('derives closed availability when a source reports a closed vacancy', () => {
        const repository = createRepository();
        repository.upsert(
            scrapedJob,
            'test-source',
            '2026-01-01T10:00:00.000Z',
        );
        repository.upsert(
            { ...scrapedJob, availability: 'closed' },
            'test-source',
            '2026-01-02T10:00:00.000Z',
        );

        const job = repository.findByUrl(scrapedJob.url);
        assert.equal(job?.availability, 'closed');
        assert.equal(job?.status, 'new');
        assert.equal(job?.sources[0]?.availability, 'closed');
    });
});
