import type { ScrapedJob } from '../types/job.js';

// Every provider follows the same small contract, allowing ingestion to remain
// independent of the website or API being queried.
export interface JobProvider {
    name: string;
    search(query: string): Promise<ScrapedJob[]>;
}
