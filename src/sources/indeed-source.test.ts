import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IndeedSource, parseIndeedJobs } from './indeed-source.js';

describe('parseIndeedJobs', () => {
    it('maps Indeed result cards to normalized jobs', () => {
        const jobs = parseIndeedJobs(`
            <div class="job_seen_beacon">
                <h2 class="jobTitle"><a href="/viewjob?jk=abc">Lokförare</a></h2>
                <span class="companyName">Green Cargo</span>
                <div class="companyLocation">Sundsvall</div>
                <div class="job-snippet">Kör godståg i regional trafik.</div>
            </div>
        `);

        assert.deepEqual(jobs, [
            {
                title: 'Lokförare',
                company: 'Green Cargo',
                location: 'Sundsvall',
                url: 'https://se.indeed.com/viewjob?jk=abc',
                sourceUrl: 'https://se.indeed.com/viewjob?jk=abc',
                description: 'Kör godståg i regional trafik.',
                applicationDeadline: null,
            },
        ]);
    });
});

describe('IndeedSource', () => {
    it('reports access protection clearly', async () => {
        const fetchImpl: typeof fetch = async () =>
            new Response(null, { status: 403 });

        await assert.rejects(
            () => new IndeedSource(fetchImpl).search('lokförare'),
            /Indeed denied the request with HTTP 403/,
        );
    });

    it('reports Indeed security challenges clearly', async () => {
        const fetchImpl: typeof fetch = async () =>
            new Response('<h1>Additional Verification Required</h1>', {
                status: 200,
            });

        await assert.rejects(
            () => new IndeedSource(fetchImpl).search('lokförare'),
            /Indeed returned a security check/,
        );
    });
});
