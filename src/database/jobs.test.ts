import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createDatabase } from './database.js';
import { JobsRepository } from './jobs.js';
import type { IngestedJob } from '../types/job.js';

const databases: ReturnType<typeof createDatabase>[] = [];

function createRepository(): JobsRepository {
    // Each test gets an isolated database, so tests never depend on the local
    // data/jobs.db file or on the order in which tests run.
    const database = createDatabase(':memory:');
    databases.push(database);
    return new JobsRepository(database);
}

const scrapedJob: IngestedJob = {
    title: 'Lokförare',
    company: 'Nordic Rail AB',
    location: 'Stockholm',
    canonicalUrl: 'https://example.com/jobs/driver',
    listingUrl: 'https://example.com/jobs/driver',
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
        const job = repository.findByCanonicalUrl(scrapedJob.canonicalUrl);

        assert.equal(result, 'inserted');
        assert.equal(repository.list().length, 1);
        assert.equal(job?.discoveredAt, '2026-01-01T10:00:00.000Z');
        assert.equal(job?.lastSeenAt, '2026-01-01T10:00:00.000Z');
        assert.equal(job?.aiCategory, null);
        assert.equal(job?.applicationDeadline, '2026-01-15');
        assert.deepEqual(job?.links, [
            {
                provider: 'test-source',
                url: scrapedJob.listingUrl,
                kind: 'listing',
                firstSeenAt: '2026-01-01T10:00:00.000Z',
                lastSeenAt: '2026-01-01T10:00:00.000Z',
                availability: 'active',
                checkedAt: '2026-01-01T10:00:00.000Z',
            },
        ]);
        assert.equal(job?.canonicalUrl, scrapedJob.canonicalUrl);
    });

    it('updates title and source-owned fields for an existing URL', () => {
        const repository = createRepository();
        repository.upsert(
            scrapedJob,
            'first-source',
            '2026-01-01T10:00:00.000Z',
        );
        const firstJob = repository.findByCanonicalUrl(scrapedJob.canonicalUrl);
        assert.ok(firstJob);
        repository.updateAiCategory(firstJob.id, 'Persontåg');

        // AI evaluations must survive a source refresh even though the source-
        // owned fields and title are updated.
        const result = repository.upsert(
            { ...scrapedJob, title: 'Updated title from source' },
            'first-source',
            '2026-01-02T10:00:00.000Z',
        );
        const job = repository.findByCanonicalUrl(scrapedJob.canonicalUrl);

        assert.equal(result, 'updated');
        assert.equal(repository.list().length, 1);
        assert.equal(job?.discoveredAt, '2026-01-01T10:00:00.000Z');
        assert.equal(job?.lastSeenAt, '2026-01-02T10:00:00.000Z');
        assert.equal(job?.title, 'Updated title from source');
        assert.equal(job?.aiCategory, 'Persontåg');
    });

    it('removes an older source row when a canonical duplicate is found', () => {
        const repository = createRepository();
        const canonicalUrl = 'https://emp.jobylon.com/jobs/380014';
        const firstSourceUrl =
            'https://jarnvagsjobb.se/lediga-jobb/green-cargo/';
        const secondSourceUrl = 'https://jobbland.se/jobb/green-cargo-20548873';

        repository.upsert(
            {
                ...scrapedJob,
                canonicalUrl,
                listingUrl: firstSourceUrl,
                applicationUrl: canonicalUrl,
            },
            'jarnvagsjobb.se',
            '2026-01-01T10:00:00.000Z',
        );
        repository.upsert(
            {
                ...scrapedJob,
                canonicalUrl: secondSourceUrl,
                listingUrl: secondSourceUrl,
            },
            'jobbland.se',
            '2026-01-01T10:00:00.000Z',
        );
        repository.upsert(
            {
                ...scrapedJob,
                canonicalUrl,
                listingUrl: secondSourceUrl,
                applicationUrl: canonicalUrl,
            },
            'jobbland.se',
            '2026-01-02T10:00:00.000Z',
        );

        assert.equal(repository.list().length, 1);
        assert.equal(
            repository.findByCanonicalUrl(canonicalUrl)?.lastSeenAt,
            '2026-01-02T10:00:00.000Z',
        );
        assert.equal(repository.findByCanonicalUrl(canonicalUrl)?.links.length, 4);
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

        const job = repository.findByCanonicalUrl(scrapedJob.canonicalUrl);
        assert.equal(job?.availability, 'closed');
        assert.equal(job?.links[0]?.availability, 'closed');
    });

    it('preserves AI category for uninteresting jobs upon re-ingestion', () => {
        const repository = createRepository();
        repository.upsert(
            scrapedJob,
            'test-source',
            '2026-01-01T10:00:00.000Z',
        );
        const firstJob = repository.findByCanonicalUrl(scrapedJob.canonicalUrl);
        assert.ok(firstJob);
        repository.updateAiCategory(firstJob.id, 'Ointressant');

        const jobAfterCategory = repository.findByCanonicalUrl(scrapedJob.canonicalUrl);
        assert.equal(jobAfterCategory?.aiCategory, 'Ointressant');

        // Re-ingest the same job
        repository.upsert(
            scrapedJob,
            'test-source',
            '2026-01-02T10:00:00.000Z',
        );

        const jobAfterReingest = repository.findByCanonicalUrl(scrapedJob.canonicalUrl);
        assert.equal(jobAfterReingest?.aiCategory, 'Ointressant');
    });

    it('derives closed availability when application deadline has passed', () => {
        const repository = createRepository();
        repository.upsert(
            {
                ...scrapedJob,
                canonicalUrl: 'https://example.com/jobs/expired',
                listingUrl: 'https://example.com/jobs/expired',
                applicationDeadline: '2020-01-01',
            },
            'test-source',
            '2026-01-01T10:00:00.000Z',
        );

        const job = repository.findByCanonicalUrl(
            'https://example.com/jobs/expired',
        );
        assert.equal(job?.availability, 'closed');
    });

    it('stores the listing and application destinations as separate links', () => {
        const repository = createRepository();
        const applicationUrl =
            'https://emp.jobylon.com/applications/jobs/380014/create/';
        repository.upsert(
            {
                ...scrapedJob,
                canonicalUrl: 'https://emp.jobylon.com/jobs/380014',
                listingUrl: 'https://board.example/jobs/driver',
                applicationUrl,
            },
            'board.example',
            '2026-01-01T10:00:00.000Z',
        );

        const job = repository.findByCanonicalUrl(
            'https://emp.jobylon.com/jobs/380014',
        );
        assert.deepEqual(
            job?.links.map(({ kind, url, availability }) => ({
                kind,
                url,
                availability,
            })),
            [
                {
                    kind: 'application',
                    url: applicationUrl,
                    availability: null,
                },
                {
                    kind: 'listing',
                    url: 'https://board.example/jobs/driver',
                    availability: 'active',
                },
            ],
        );
    });

    it('does not replace a known application identity when a later scrape omits it', () => {
        const repository = createRepository();
        const canonicalUrl = 'https://apply.example/jobs/driver';
        const listingUrl = 'https://board.example/jobs/driver';
        repository.upsert(
            {
                ...scrapedJob,
                canonicalUrl,
                listingUrl,
                applicationUrl: canonicalUrl,
            },
            'board.example',
            '2026-01-01T10:00:00.000Z',
        );
        repository.upsert(
            {
                ...scrapedJob,
                canonicalUrl: listingUrl,
                listingUrl,
                applicationUrl: null,
            },
            'board.example',
            '2026-01-02T10:00:00.000Z',
        );

        assert.equal(repository.list().length, 1);
        assert.equal(
            repository.findByCanonicalUrl(canonicalUrl)?.canonicalUrl,
            canonicalUrl,
        );
    });
});
