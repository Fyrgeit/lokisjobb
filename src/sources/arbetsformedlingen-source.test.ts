import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    ArbetsformedlingenSource,
    mapArbetsformedlingenHit,
} from './arbetsformedlingen-source.js';

describe('mapArbetsformedlingenHit', () => {
    it('maps JobTech API data to a normalized job', () => {
        const job = mapArbetsformedlingenHit({
            headline: 'Lokförare till LKAB Malmtrafik',
            webpage_url:
                'https://arbetsformedlingen.se/platsbanken/annonser/31440607',
            employer: { name: 'Luossavaara-Kiirunavaara Aktiebolag' },
            workplace_address: { municipality: 'Gällivare' },
            application_deadline: '2026-09-27T23:59:59',
            description: { text: 'Kör malmtåg längs Malmbanan.' },
        });

        assert.deepEqual(job, {
            title: 'Lokförare till LKAB Malmtrafik',
            company: 'Luossavaara-Kiirunavaara Aktiebolag',
            location: 'Gällivare',
            url: 'https://arbetsformedlingen.se/platsbanken/annonser/31440607',
            sourceUrl:
                'https://arbetsformedlingen.se/platsbanken/annonser/31440607',
            description: 'Kör malmtåg längs Malmbanan.',
            applicationDeadline: '2026-09-27',
        });
    });
});

describe('ArbetsformedlingenSource', () => {
    it('searches the public JobTech API', async () => {
        let requestedUrl = '';
        const fetchImpl: typeof fetch = async (input) => {
            requestedUrl = String(input);
            return new Response(JSON.stringify({ hits: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        };

        const jobs = await new ArbetsformedlingenSource(fetchImpl).search(
            'lokförare',
        );

        assert.deepEqual(jobs, []);
        assert.match(requestedUrl, /jobsearch\.api\.jobtechdev\.se\/search/);
        assert.match(requestedUrl, /q=lokf%C3%B6rare/);
    });
});
