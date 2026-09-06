import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JobbsafariSource, parseJobbsafariJobs } from './jobbsafari-source.js';

const result = {
    title: 'Lokförare',
    slug: 'lokforare-20541239',
    startDate: '2026-09-01 22:00:01',
    endDate: '2026-10-02 21:59:59',
    company: { name: 'Ren Labs Stockholm AB' },
    locations: [{ name: 'Stockholm' }],
};

function pageData(data: object): string {
    return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
}

describe('parseJobbsafariJobs', () => {
    it('maps embedded search results to normalized jobs', () => {
        const jobs = parseJobbsafariJobs(
            pageData({
                props: { pageProps: { jobEntries: { results: [result] } } },
            }),
        );

        assert.deepEqual(jobs, [
            {
                title: 'Lokförare',
                company: 'Ren Labs Stockholm AB',
                location: 'Stockholm',
                url: 'https://jobbsafari.se/lediga-jobb/lokforare-20541239',
                sourceUrl:
                    'https://jobbsafari.se/lediga-jobb/lokforare-20541239',
                description: null,
                applicationDeadline: '2026-10-02',
            },
        ]);
    });

    it('treats Jobbsafari far-future deadlines as missing', () => {
        const jobs = parseJobbsafariJobs(
            pageData({
                props: {
                    pageProps: {
                        jobEntries: {
                            results: [
                                { ...result, endDate: '2650-08-06 21:59:59' },
                            ],
                        },
                    },
                },
            }),
        );

        assert.equal(jobs[0]?.applicationDeadline, null);
    });
});

describe('JobbsafariSource', () => {
    it('enriches search results with detail-page descriptions', async () => {
        const searchHtml = pageData({
            props: { pageProps: { jobEntries: { results: [result] } } },
        });
        const detailHtml = pageData({
            props: {
                pageProps: {
                    jobEntry: {
                        ...result,
                        description: { text: 'Kör tåg säkert och punktligt.' },
                    },
                },
            },
        });
        const fetchImpl: typeof fetch = async (input) =>
            new Response(
                String(input).includes('lokforare-20541239')
                    ? detailHtml
                    : searchHtml,
                { status: 200 },
            );

        const jobs = await new JobbsafariSource(fetchImpl).search('lokförare');

        assert.equal(jobs[0]?.description, 'Kör tåg säkert och punktligt.');
    });
});
