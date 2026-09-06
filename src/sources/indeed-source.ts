import { load } from 'cheerio';
import type { ScrapedJob } from '../types/job.js';
import type { JobSource } from './job-source.js';

export const indeedJobsUrl = 'https://se.indeed.com/jobs';

function cleanText(value: string | undefined): string | null {
    const text = value?.replace(/\s+/g, ' ').trim();
    return text || null;
}

export function parseIndeedJobs(
    html: string,
    sourceUrl = indeedJobsUrl,
): ScrapedJob[] {
    const $ = load(html);
    const jobs: ScrapedJob[] = [];

    // These selectors target Indeed's server-rendered result cards. If Indeed
    // changes its markup, only this parser should need to be updated.
    $('div.job_seen_beacon, div[data-jk]').each((_index, element) => {
        const card = $(element);
        const titleLink = card.find('h2.jobTitle a, a.jcs-JobTitle').first();
        const title = cleanText(titleLink.text());
        const href = titleLink.attr('href');

        if (!title || !href) {
            return;
        }

        jobs.push({
            title,
            company: cleanText(
                card
                    .find('[data-testid="company-name"], .companyName')
                    .first()
                    .text(),
            ),
            location: cleanText(
                card
                    .find('[data-testid="text-location"], .companyLocation')
                    .first()
                    .text(),
            ),
            url: new URL(href, sourceUrl).toString(),
            description: cleanText(card.find('.job-snippet').first().text()),
            applicationDeadline: null,
        });
    });

    return jobs;
}

function isIndeedChallengePage(html: string): boolean {
    return /Additional Verification Required|INDEED_CLOUDFLARE_STATIC_PAGE|enable JavaScript to complete the security check/i.test(
        html,
    );
}

export class IndeedSource implements JobSource {
    public readonly name = 'indeed.com';

    public constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    public async search(query: string): Promise<ScrapedJob[]> {
        const url = new URL(indeedJobsUrl);
        url.searchParams.set('q', query);
        url.searchParams.set('l', 'sverige');

        const response = await this.fetchImpl(url, {
            headers: {
                Accept: 'text/html',
                'User-Agent': 'Lokisjobb/0.1 (local personal job search)',
            },
        });

        if (!response.ok) {
            if (response.status === 403) {
                throw new Error(
                    'Indeed denied the request with HTTP 403. A browser session or an approved job-search API is required for this source.',
                );
            }

            throw new Error(
                `Indeed request failed with HTTP ${response.status}`,
            );
        }

        const html = await response.text();
        if (isIndeedChallengePage(html)) {
            throw new Error(
                'Indeed returned a security check. A browser session or an approved job-search API is required for this source.',
            );
        }

        return parseIndeedJobs(html, url.toString());
    }
}
