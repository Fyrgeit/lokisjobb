import type { ScrapedJob } from '../types/job.js';

export interface JobSource {
    name: string;
    search(query: string): Promise<ScrapedJob[]>;
}
