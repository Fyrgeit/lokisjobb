export type JobStatus = 'new' | 'interested' | 'rejected' | 'applied';

// This is the contract between any job source and the ingestion layer.
// It contains source data only, with no SQLite-specific fields.
export interface ScrapedJob {
    title: string;
    company: string | null;
    location: string | null;
    url: string;
    description: string | null;
    applicationDeadline: string | null;
}

// Job is the database-backed form of ScrapedJob. The extra fields represent
// local tracking and future evaluation, rather than information scraped from a site.
export interface Job extends ScrapedJob {
    id: number;
    discoveredAt: string;
    lastSeenAt: string;
    aiScore: number | null;
    status: JobStatus;
}
