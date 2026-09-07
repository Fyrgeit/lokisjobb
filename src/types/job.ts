export type JobStatus = 'new' | 'interested' | 'rejected' | 'applied';
export type SourceAvailability = 'active' | 'closed' | 'unknown';

export interface JobSourceRecord {
    name: string;
    url: string;
    firstSeenAt: string;
    lastSeenAt: string;
    checkedAt: string;
    availability: SourceAvailability;
}

// This is the contract between any job source and the ingestion layer.
// It contains source data only, with no SQLite-specific fields.
export interface ScrapedJob {
    title: string;
    company: string | null;
    location: string | null;
    url: string;
    sourceUrl: string;
    description: string | null;
    applicationDeadline: string | null;
    availability?: SourceAvailability;
}

// Job is the database-backed form of ScrapedJob. The extra fields represent
// local tracking and future evaluation, rather than information scraped from a site.
export interface Job extends Omit<ScrapedJob, 'sourceUrl'> {
    id: number;
    discoveredAt: string;
    lastSeenAt: string;
    aiScore: number | null;
    status: JobStatus;
    sources: JobSourceRecord[];
    availability: SourceAvailability;
}
