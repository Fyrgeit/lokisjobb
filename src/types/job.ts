export type JobStatus = 'new' | 'interested' | 'rejected' | 'applied';

export interface ScrapedJob {
    title: string;
    company: string | null;
    location: string | null;
    url: string;
    description: string | null;
}

export interface Job extends ScrapedJob {
    id: number;
    discoveredAt: string;
    lastSeenAt: string;
    aiScore: number | null;
    status: JobStatus;
}
