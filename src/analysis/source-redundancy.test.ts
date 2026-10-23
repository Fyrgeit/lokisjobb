import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeSourceRedundancy } from './source-redundancy.js';
import type { Job } from '../types/job.js';

describe('analyzeSourceRedundancy', () => {
    it('correctly calculates total unique jobs, source stats, and minimal covers', () => {
        const mockJobs: Job[] = [
            {
                id: 1,
                title: 'Job 1',
                company: 'Comp A',
                location: 'Stockholm',
                url: 'https://example.com/1',
                description: null,
                applicationDeadline: null,
                discoveredAt: '2026-01-01T00:00:00.000Z',
                lastSeenAt: '2026-01-01T00:00:00.000Z',
                aiScore: null,
                status: 'new',
                availability: 'active',
                sources: [
                    {
                        name: 'jobbland',
                        url: 'https://example.com/1',
                        firstSeenAt: '2026-01-01T00:00:00.000Z',
                        lastSeenAt: '2026-01-01T00:00:00.000Z',
                        availability: 'active',
                        checkedAt: '2026-01-01T00:00:00.000Z',
                    },
                    {
                        name: 'arbetsformedlingen',
                        url: 'https://example.com/1',
                        firstSeenAt: '2026-01-01T00:00:00.000Z',
                        lastSeenAt: '2026-01-01T00:00:00.000Z',
                        availability: 'active',
                        checkedAt: '2026-01-01T00:00:00.000Z',
                    },
                ],
            },
            {
                id: 2,
                title: 'Job 2',
                company: 'Comp B',
                location: 'Göteborg',
                url: 'https://example.com/2',
                description: null,
                applicationDeadline: null,
                discoveredAt: '2026-01-01T00:00:00.000Z',
                lastSeenAt: '2026-01-01T00:00:00.000Z',
                aiScore: null,
                status: 'new',
                availability: 'active',
                sources: [
                    {
                        name: 'jobbland',
                        url: 'https://example.com/2',
                        firstSeenAt: '2026-01-01T00:00:00.000Z',
                        lastSeenAt: '2026-01-01T00:00:00.000Z',
                        availability: 'active',
                        checkedAt: '2026-01-01T00:00:00.000Z',
                    },
                ],
            },
            {
                id: 3,
                title: 'Job 3',
                company: 'Comp C',
                location: 'Malmö',
                url: 'https://example.com/3',
                description: null,
                applicationDeadline: null,
                discoveredAt: '2026-01-01T00:00:00.000Z',
                lastSeenAt: '2026-01-01T00:00:00.000Z',
                aiScore: null,
                status: 'new',
                availability: 'active',
                sources: [
                    {
                        name: 'jobbsafari',
                        url: 'https://example.com/3',
                        firstSeenAt: '2026-01-01T00:00:00.000Z',
                        lastSeenAt: '2026-01-01T00:00:00.000Z',
                        availability: 'active',
                        checkedAt: '2026-01-01T00:00:00.000Z',
                    },
                ],
            },
        ];

        const report = analyzeSourceRedundancy(mockJobs);

        assert.equal(report.totalUniqueJobs, 3);
        assert.equal(report.sources.length, 3);

        const jobbland = report.sources.find((s) => s.name === 'jobbland');
        assert.equal(jobbland?.totalJobs, 2);
        assert.equal(jobbland?.exclusiveJobs, 1); // Job 2 is exclusive to jobbland

        const jobbsafari = report.sources.find((s) => s.name === 'jobbsafari');
        assert.equal(jobbsafari?.totalJobs, 1);
        assert.equal(jobbsafari?.exclusiveJobs, 1); // Job 3 is exclusive to jobbsafari

        // Minimal covers that cover all 3 jobs
        assert.ok(report.minimalCovers.length > 0);
        const bestCover = report.minimalCovers[0];
        assert.equal(bestCover.coversAll, true);
    });
});
