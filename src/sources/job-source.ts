import type { ScrapedJob } from '../types/job.js';

// Every source follows the same small contract, allowing ingestion to remain
// independent of the website or API being queried.
export interface JobSource {
    name: string;
    search(query: string): Promise<ScrapedJob[]>;
}
