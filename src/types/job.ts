export type SourceAvailability = 'active' | 'closed' | 'unknown';
export type JobLinkKind = 'listing' | 'application';
export type AiCategory =
    | 'Persontåg'
    | 'Godståg'
    | 'Växlare'
    | 'Intressant'
    | 'Ointressant';

export interface JobLink {
    provider: string;
    url: string;
    kind: JobLinkKind;
    firstSeenAt: string;
    lastSeenAt: string;
    checkedAt: string | null;
    availability: SourceAvailability | null;
}

// This is the contract between any job provider and the ingestion layer.
export interface ScrapedJob {
    title: string;
    company: string | null;
    location: string | null;
    listingUrl: string;
    applicationUrl?: string | null;
    description: string | null;
    applicationDeadline: string | null;
    availability?: SourceAvailability;
}

export interface IngestedJob extends ScrapedJob {
    canonicalUrl: string;
}

// Job is the database-backed form of a scraped job.
export interface Job extends Omit<ScrapedJob, 'listingUrl' | 'applicationUrl' | 'availability'> {
    id: number;
    canonicalUrl: string;
    discoveredAt: string;
    lastSeenAt: string;
    aiCategory: AiCategory | null;
    links: JobLink[];
    availability: SourceAvailability;
}
