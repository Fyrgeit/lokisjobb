import type { ScrapedJob } from '../types/job.js';
import type { JobSource } from './job-source.js';

export class MockJobSource implements JobSource {
    public readonly name = 'mock';

    public async search(query: string): Promise<ScrapedJob[]> {
        return [
            {
                title: `${query} till regional trafik`,
                company: 'Nordic Rail AB',
                location: 'Stockholm',
                url: 'https://example.com/jobs/regional-driver',
                description:
                    'Kör regional trafik och bidra till trygga resor varje dag.',
            },
            {
                title: 'Trafikplanerare',
                company: 'City Transit',
                location: 'Göteborg',
                url: 'https://example.com/jobs/traffic-planner',
                description:
                    'Planera trafikflöden och samordna den dagliga driften.',
            },
            {
                title: 'Underhållstekniker',
                company: 'Rail Systems',
                location: 'Malmö',
                url: 'https://example.com/jobs/maintenance-technician',
                description:
                    'Arbeta med förebyggande underhåll av modern infrastruktur.',
            },
        ];
    }
}
