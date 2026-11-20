import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    canonicalizeApplicationUrl,
    ingestFromSource,
} from './ingestion.js';
import type { IngestedJob, ScrapedJob } from '../types/job.js';

describe('canonicalizeApplicationUrl', () => {
    it('removes syndicated application tracking parameters', () => {
        assert.equal(
            canonicalizeApplicationUrl(
                'https://jobb.sj.se/jobs/8247962-fordonsoperator?promotion=2154712-arbetsformedlingen&utm_source=jobbsafari.se',
            ),
            'https://jobb.sj.se/jobs/8247962-fordonsoperator',
        );
    });
});

describe('ingestFromSource', () => {
    it('uses the application destination for identity while retaining both links', async () => {
        const scrapedJob: ScrapedJob = {
            title: 'Lokförare',
            company: null,
            location: null,
            listingUrl: 'https://board.example/jobs/1',
            applicationUrl:
                'https://emp.jobylon.com/applications/jobs/380014/create/',
            description: null,
            applicationDeadline: null,
        };
        let ingestedJob: IngestedJob | undefined;
        const originalLog = console.log;
        console.log = () => {};

        try {
            await ingestFromSource(
                { name: 'board.example', search: async () => [scrapedJob] },
                'lokförare',
                {
                    upsert: (job) => {
                        ingestedJob = job;
                        return 'inserted';
                    },
                },
            );
        } finally {
            console.log = originalLog;
        }

        assert.equal(
            ingestedJob?.canonicalUrl,
            'https://emp.jobylon.com/jobs/380014',
        );
        assert.equal(ingestedJob?.listingUrl, scrapedJob.listingUrl);
        assert.equal(ingestedJob?.applicationUrl, scrapedJob.applicationUrl);
    });

    it('leaves the canonical URL unset for mailto application links', async () => {
        const scrapedJob: ScrapedJob = {
            title: 'Lokförare',
            company: null,
            location: null,
            listingUrl: 'https://board.example/jobs/1',
            applicationUrl: 'mailto:apply@example.com',
            description: null,
            applicationDeadline: null,
        };
        let ingestedJob: IngestedJob | undefined;
        const originalLog = console.log;
        console.log = () => {};

        try {
            await ingestFromSource(
                { name: 'board.example', search: async () => [scrapedJob] },
                'lokförare',
                {
                    upsert: (job) => {
                        ingestedJob = job;
                        return 'inserted';
                    },
                },
            );
        } finally {
            console.log = originalLog;
        }

        assert.equal(ingestedJob?.canonicalUrl, null);
        assert.equal(ingestedJob?.applicationUrl, scrapedJob.applicationUrl);
    });
});
