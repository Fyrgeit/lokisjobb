import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import type { Job } from './types/job.js';

const descriptionLimit = 80;

// Keep the database value complete, but make terminal output easy to scan.
function formatDescription(description: string | null): string {
    if (!description) {
        return 'Ingen beskrivning';
    }

    if (description.length <= descriptionLimit) {
        return description;
    }

    return `${description.slice(0, descriptionLimit).trimEnd()}...`;
}

function formatJob(job: Job): string {
    return [
        `#${job.id} ${job.title}`,
        `Företag: ${job.company ?? 'Ej angivet'}`,
        `Ort: ${job.location ?? 'Ej angiven'}`,
        `Sista ansökningsdag: ${job.applicationDeadline ?? 'Ej angiven'}`,
        `Tillgänglighet: ${formatAvailability(job.availability)}`,
        `AI-kategori: ${job.aiCategory ?? 'Ej klassificerad'}`,
        `Upptäckt: ${job.discoveredAt}`,
        `Senast sedd: ${job.lastSeenAt}`,
        `URL: ${job.url}`,
        `Källor (${job.sources.length}): ${job.sources.map((source) => `${source.name} [${formatAvailability(source.availability)}] (${source.url})`).join(', ') || 'Inga'}`,
        `Beskrivning: ${formatDescription(job.description)}`,
    ].join('\n');
}

function formatAvailability(availability: Job['availability']): string {
    return {
        active: 'Aktiv',
        closed: 'Stängd',
        unknown: 'Okänd',
    }[availability];
}

export function getJobs() {
    const config = getConfig();
    const database = createDatabase(config.databasePath);

    try {
        // This command is intentionally read-only: it uses the repository's
        // list operation and never changes job state.
        const jobs = new JobsRepository(database).list();

        if (jobs.length === 0) {
            return { error: 'Inga jobb hittades. Kör npm run dev för att hämta jobbannonser.' };
        }

        return { jobs: jobs };
    } finally {
        database.close();
    }
}

function main(): void {
    const jobs = getJobs();

    if (jobs.error) {
        console.log(jobs.error);
    }

    if (jobs.jobs) {
        console.log(
            `Jobb (${jobs.jobs.length})\n` +
                jobs.jobs.map(formatJob).join('\n\n---\n\n'),
        );
    }
}

main();
