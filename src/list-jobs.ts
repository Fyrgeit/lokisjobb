import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import type { Job } from './types/job.js';

const descriptionLimit = 80;

// Keep the database value complete, but make terminal output easy to scan.
function formatDescription(description: string | null): string {
    if (!description) {
        return 'No description';
    }

    if (description.length <= descriptionLimit) {
        return description;
    }

    return `${description.slice(0, descriptionLimit).trimEnd()}...`;
}

function formatJob(job: Job): string {
    return [
        `#${job.id} ${job.title}`,
        `Company: ${job.company ?? 'Not specified'}`,
        `Location: ${job.location ?? 'Not specified'}`,
        `Application deadline: ${job.applicationDeadline ?? 'Not specified'}`,
        `Status: ${job.status}`,
        `AI score: ${job.aiScore ?? 'Not evaluated'}`,
        `Discovered: ${job.discoveredAt}`,
        `Last seen: ${job.lastSeenAt}`,
        `URL: ${job.url}`,
        `Source URL: ${job.sourceUrl}`,
        `Description: ${formatDescription(job.description)}`,
    ].join('\n');
}

function main(): void {
    const config = getConfig();
    const database = createDatabase(config.databasePath);

    try {
        // This command is intentionally read-only: it uses the repository's
        // list operation and never changes job state.
        const jobs = new JobsRepository(database).list();

        if (jobs.length === 0) {
            console.log('No jobs found. Run npm run dev to ingest jobs.');
            return;
        }

        console.log(`Jobs (${jobs.length})\n`);
        console.log(jobs.map(formatJob).join('\n\n---\n\n'));
    } finally {
        database.close();
    }
}

main();
