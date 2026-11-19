import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeProviderRedundancy } from './provider-redundancy.js';
import type { Job, JobLink } from '../types/job.js';

function createJob(
    id: number,
    providerNames: string[],
    aiCategory: Job['aiCategory'] = null,
): Job {
    const now = '2026-01-01T00:00:00.000Z';
    const links: JobLink[] = providerNames.map((provider) => ({
        provider,
        url: `https://${provider}.example/jobs/${id}`,
        kind: 'listing',
        firstSeenAt: now,
        lastSeenAt: now,
        availability: 'active',
        checkedAt: now,
    }));

    return {
        id,
        title: `Job ${id}`,
        company: `Comp ${id}`,
        location: 'Stockholm',
        canonicalUrl: `https://example.com/${id}`,
        description: null,
        applicationDeadline: null,
        discoveredAt: now,
        lastSeenAt: now,
        aiCategory,
        availability: 'active',
        links,
    };
}

describe('analyzeProviderRedundancy', () => {
    it('calculates provider stats and minimal covers from listing links', () => {
        const mockJobs = [
            createJob(1, ['jobbland', 'arbetsformedlingen']),
            createJob(2, ['jobbland']),
            createJob(3, ['jobbsafari']),
        ];

        const report = analyzeProviderRedundancy(mockJobs);

        assert.equal(report.totalUniqueJobs, 3);
        assert.equal(report.providers.length, 3);

        const jobbland = report.providers.find(
            (provider) => provider.name === 'jobbland',
        );
        assert.equal(jobbland?.totalJobs, 2);
        assert.equal(jobbland?.exclusiveJobs, 1);
        assert.equal(jobbland?.noExclusiveJobs, false);

        const jobbsafari = report.providers.find(
            (provider) => provider.name === 'jobbsafari',
        );
        assert.equal(jobbsafari?.totalJobs, 1);
        assert.equal(jobbsafari?.exclusiveJobs, 1);
        assert.equal(jobbsafari?.noExclusiveJobs, false);

        assert.ok(report.minimalCovers.length > 0);
        assert.equal(report.minimalCovers[0].coversAll, true);
    });

    it('excludes application links from provider coverage', () => {
        const job = createJob(1, []);
        job.links.push({
            provider: 'ats.example',
            url: 'https://ats.example/apply/1',
            kind: 'application',
            firstSeenAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: '2026-01-01T00:00:00.000Z',
            availability: null,
            checkedAt: null,
        });

        const report = analyzeProviderRedundancy([job]);
        assert.equal(report.totalUniqueJobs, 1);
        assert.deepEqual(report.providers, []);
        assert.deepEqual(report.minimalCovers, []);
    });

    it('excludes jobs classified as uninteresting from redundancy analysis', () => {
        const report = analyzeProviderRedundancy([
            createJob(1, ['jobbland'], 'Ointressant'),
            createJob(2, ['jobbsafari'], 'Godståg'),
        ]);

        assert.equal(report.totalUniqueJobs, 1);
        assert.equal(report.providers.length, 1);
        assert.equal(report.providers[0].name, 'jobbsafari');
        assert.equal(report.providers[0].totalJobs, 1);
    });
});
