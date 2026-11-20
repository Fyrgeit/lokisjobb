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
                canonicalUrl: null,
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

    it('merges strongly matching listings without an application URL', () => {
        const repository = createRepository();
        const description =
            'SHN Cargo Sverige AB söker lokförare till stationeringsort Falköping. Du genomför säkra och effektiva godstransporter och samarbetar med kollegor. Vi söker dig med lokförarbevis, yrkeserfarenhet och högt säkerhetstänkande. Heltid med varierande tjänstgöring enligt 5/2-schema. Sista ansökningsdag är 15 december 2026.';
        const firstListing = 'https://board-one.example/jobs/driver';
        const secondListing = 'https://board-two.example/jobs/driver';

        repository.upsert(
            {
                ...scrapedJob,
                title: 'Lokförare till SHN Cargo',
                company: 'SHN Cargo AB',
                location: null,
                canonicalUrl: null,
                listingUrl: firstListing,
                description,
                applicationDeadline: '2026-12-15',
            },
            'board-one.example',
            '2026-11-12T10:00:00.000Z',
        );
        repository.upsert(
            {
                ...scrapedJob,
                title: 'Lokförare till SHN Cargo',
                company: 'SHN Cargo AB',
                location: 'De nordiska länderna',
                canonicalUrl: null,
                listingUrl: secondListing,
                description: `${description} Lön enligt överenskommelse.`,
                applicationDeadline: '2026-12-15',
            },
            'board-two.example',
            '2026-11-12T11:00:00.000Z',
        );

        const jobs = repository.list();
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0]?.canonicalUrl, null);
        assert.deepEqual(
            jobs[0]?.links.map((link) => link.url).sort(),
            [firstListing, secondListing],
        );
    });

    it('merges a listing with a matching location when an existing description is missing', () => {
        const repository = createRepository();
        const canonicalUrl = 'https://easyapply.jobs/r/rail-yard';
        const title = 'Växlare/bangårdsoperatör till ProTrain i Göteborgs Hamn';
        const company = 'ProTrain Bemanning AB';
        const deadline = '2026-11-20';

        repository.upsert(
            {
                ...scrapedJob,
                title,
                company,
                location: 'Göteborg',
                canonicalUrl,
                listingUrl: 'https://arbetsformedlingen.se/platsbanken/annonser/1',
                description: null,
                applicationDeadline: deadline,
            },
            'arbetsformedlingen.se',
        );
        repository.upsert(
            {
                ...scrapedJob,
                title,
                company,
                location: 'Göteborg',
                canonicalUrl,
                listingUrl:
                    'https://jobbsafari.se/lediga-jobb/vaxlare-protrain',
                description: null,
                applicationDeadline: deadline,
            },
            'jobbsafari.se',
        );
        repository.upsert(
            {
                ...scrapedJob,
                title,
                company,
                location: 'Göteborg',
                canonicalUrl: null,
                listingUrl: 'https://jobbland.se/jobb/vaxlare-protrain',
                description:
                    'ProTrain söker växlare till Göteborgs Hamn. '.repeat(5),
                applicationDeadline: deadline,
            },
            'jobbland.se',
        );

        const jobs = repository.list();
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0]?.canonicalUrl, canonicalUrl);
        assert.ok(jobs[0]?.description);
        assert.deepEqual(
            jobs[0]?.links.map((link) => link.provider).sort(),
            ['arbetsformedlingen.se', 'jobbland.se', 'jobbsafari.se'],
        );
    });

    it('does not merge listings with missing descriptions when locations differ', () => {
        const repository = createRepository();
        const matchFields = {
            ...scrapedJob,
            title: 'Växlare/bangårdsoperatör till ProTrain i Göteborgs Hamn',
            company: 'ProTrain Bemanning AB',
            applicationDeadline: '2026-11-20',
            canonicalUrl: null,
            description: null,
        };

        repository.upsert(
            { ...matchFields, location: 'Göteborg' },
            'board-one.example',
        );
        repository.upsert(
            {
                ...matchFields,
                location: 'Gävle',
                listingUrl: 'https://board-two.example/jobs/rail-yard',
                description: 'A separate vacancy with its own description.',
            },
            'board-two.example',
        );

        assert.equal(repository.list().length, 2);
    });

    it('does not merge similar titles with different descriptions', () => {
        const repository = createRepository();
        repository.upsert(
            {
                ...scrapedJob,
                title: 'Lokförare till SHN Cargo',
                company: 'SHN Cargo AB',
                canonicalUrl: null,
                description:
                    'SHN Cargo söker lokförare till godstrafik i Falköping. ' +
                    'Erfarenhet och giltigt lokförarbevis krävs. '.repeat(5),
                applicationDeadline: '2026-12-15',
            },
            'board-one.example',
        );
        repository.upsert(
            {
                ...scrapedJob,
                title: 'Lokförare till SHN Cargo',
                company: 'SHN Cargo AB',
                canonicalUrl: null,
                listingUrl: 'https://board-two.example/jobs/driver',
                description:
                    'Vi söker en lokförare för persontrafik i Malmö. ' +
                    'Arbetet innebär kvällspass och helgtjänstgöring. '.repeat(5),
                applicationDeadline: '2026-12-15',
            },
            'board-two.example',
        );

        assert.equal(repository.list().length, 2);
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
                canonicalUrl: null,
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
