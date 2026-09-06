import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    JobblandSource,
    parseJobblandDescription,
    parseJobblandJobs,
} from './jobbland-source.js';

const listingHtml = `
    <div class="search-results-box">
        <div class="job-card-wrapper">
            <a class="job-card" title="Lokförare till LKAB" data-company="LKAB" data-position="0" href="/jobb/lokforare-till-lkab">
                Lokförare till LKAB LKAB Gällivare · Ansökningsperiod 4/9 – 27/9
            </a>
        </div>
    </div>
`;

function detailHtml(): string {
    return `
        <body>
            <h1>Lokförare till LKAB</h1>
            <div><h2>Om jobbet</h2><p>Kör malmtåg i Gällivare.</p></div>
            <p>Slutdatum 2026-09-27</p>
        </body>
    `;
}

describe('parseJobblandJobs', () => {
    it('maps primary search cards to normalized jobs', () => {
        assert.deepEqual(parseJobblandJobs(listingHtml), [
            {
                title: 'Lokförare till LKAB',
                company: 'LKAB',
                location: 'Gällivare',
                url: 'https://jobbland.se/jobb/lokforare-till-lkab',
                description: null,
                applicationDeadline: null,
            },
        ]);
    });

    it('ignores cards without a search-result position', () => {
        assert.deepEqual(
            parseJobblandJobs(
                listingHtml.replace(
                    'class="job-card"',
                    'class="job-card" data-position=""',
                ),
            ),
            [],
        );
    });
});

describe('JobblandSource', () => {
    it('enriches cards with detail-page content', async () => {
        const fetchImpl: typeof fetch = async (input) =>
            new Response(
                String(input).includes('/jobb/') ? detailHtml() : listingHtml,
                { status: 200 },
            );

        const jobs = await new JobblandSource(fetchImpl).search('lokförare');

        assert.equal(jobs[0]?.description, 'Kör malmtåg i Gällivare.');
        assert.equal(jobs[0]?.applicationDeadline, '2026-09-27');
    });
});

describe('parseJobblandDescription', () => {
    it('extracts only the Om jobbet section', () => {
        assert.equal(
            parseJobblandDescription(
                '<h2>Om jobbet</h2><div><p>Full annons.</p></div>',
            ),
            'Full annons.',
        );
    });
});
