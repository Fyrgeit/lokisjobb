import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    JarnvagsjobbSource,
    parseJarnvagsjobbDescription,
    parseJarnvagsjobbJobs,
} from './jarnvagsjobb-source.js';

describe('parseJarnvagsjobbJobs', () => {
    it('maps listing rows to normalized scraped jobs', () => {
        const jobs = parseJarnvagsjobbJobs(`
            <table><tbody>
                <tr>
                    <td class="list-column title"><a class="row-link" href="/lediga-jobb/lokforare/">Lokförare &#8211; Sundsvall</a></td>
                    <td class="list-column company"> Green Cargo </td>
                    <td class="list-column city"> Sundsvall </td>
                    <td class="list-column apply_by"> 2026-09-20 </td>
                </tr>
            </tbody></table>
        `);

        assert.deepEqual(jobs, [
            {
                title: 'Lokförare – Sundsvall',
                company: 'Green Cargo',
                location: 'Sundsvall',
                url: 'https://jarnvagsjobb.se/lediga-jobb/lokforare/',
                description: null,
                applicationDeadline: '2026-09-20',
            },
        ]);
    });

    it('ignores rows without a job link', () => {
        assert.deepEqual(
            parseJarnvagsjobbJobs(
                '<table><tbody><tr><td class="list-column company">Filter</td></tr></tbody></table>',
            ),
            [],
        );
    });
});

describe('parseJarnvagsjobbDescription', () => {
    it('extracts the detailed job content without page metadata', () => {
        const description = parseJarnvagsjobbDescription(`
            <article>
                <div class="entry-content">
                    <h1>Lokförare</h1>
                    <div class="single__meta">Ansök senast: 2026-09-20</div>
                    <p><strong>Arbetsuppgifter</strong></p>
                    <p>Du kör godståg och arbetar med växling.</p>
                </div>
            </article>
        `);

        assert.equal(
            description,
            'Arbetsuppgifter Du kör godståg och arbetar med växling.',
        );
    });
});

describe('JarnvagsjobbSource', () => {
    it('fetches descriptions from each detail page', async () => {
        // Stub both HTTP responses so this test verifies the two-stage source
        // flow without depending on the live website.
        const listingHtml = `
            <table><tbody>
                <tr>
                    <td class="list-column title"><a class="row-link" href="/lediga-jobb/lokforare/">Lokförare</a></td>
                    <td class="list-column company">Green Cargo</td>
                    <td class="list-column city">Sundsvall</td>
                    <td class="list-column apply_by">2026-09-20</td>
                </tr>
            </tbody></table>
        `;
        const detailHtml = `
            <article><div class="entry-content">
                <h1>Lokförare</h1>
                <div class="single__meta">Metadata</div>
                <p>Detta är den fullständiga annonsen.</p>
            </div></article>
        `;
        const fetchImpl: typeof fetch = async (input) =>
            new Response(
                String(input).includes('/lediga-jobb/lokforare/')
                    ? detailHtml
                    : listingHtml,
                { status: 200 },
            );

        const jobs = await new JarnvagsjobbSource(fetchImpl).search(
            'lokförare',
        );

        assert.equal(
            jobs[0]?.description,
            'Detta är den fullständiga annonsen.',
        );
    });
});
