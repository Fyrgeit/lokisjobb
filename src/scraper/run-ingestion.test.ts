import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JobProvider } from '../providers/job-provider.js';
import { createDatabase } from '../database/database.js';
import { JobsRepository } from '../database/jobs.js';
import { RunHistoryRepository } from '../database/run-history.js';
import {
    runIngestion,
    runFetchWithHistory,
    summarizeFetchRun,
} from './run-ingestion.js';

describe('runIngestion', () => {
    it('creates consistent run-history summaries for fetch operations', () => {
        const totals = {
            found: 12,
            added: 3,
            updated: 7,
            skipped: 2,
        };

        assert.deepEqual(summarizeFetchRun(totals, 0), {
            status: 'success',
            summary: {
                source: 'Alla källor',
                found: 12,
                added: 3,
                updated: 7,
                skipped: 2,
                failed: 0,
            },
        });
        assert.equal(summarizeFetchRun(totals, 2).status, 'partial');
    });

    it('records partial fetch history and counts failed provider queries', async () => {
        const database = createDatabase(':memory:');
        try {
            const history = new RunHistoryRepository(database);
            const result = await runFetchWithHistory(
                history,
                ['lokförare'],
                [{
                    name: 'failing',
                    async search() {
                        throw new Error('unavailable');
                    },
                }],
                new JobsRepository(database),
                {
                    onQuery: () => {},
                    onProviderStart: () => {},
                    onProviderComplete: () => {},
                    onProviderError: () => {},
                },
            );

            assert.equal(result.failedProviderQueries, 1);
            const entries = history.list();
            assert.equal(entries[0]?.status, 'partial');
            assert.equal(entries[0]?.summary.failed, 1);
        } finally {
            database.close();
        }
    });
    it('aggregates summaries and continues after provider failures', async () => {
        const events: string[] = [];
        const providers: JobProvider[] = [
            {
                name: 'first',
                async search(query) {
                    events.push(`first:${query}`);
                    return [
                        {
                            title: '',
                            company: null,
                            location: null,
                            listingUrl: '',
                            description: null,
                            applicationDeadline: null,
                        },
                    ];
                },
            },
            {
                name: 'failing',
                async search(query) {
                    events.push(`failing:${query}`);
                    throw new Error('unavailable');
                },
            },
            {
                name: 'last',
                async search(query) {
                    events.push(`last:${query}`);
                    return [
                        {
                            title: '',
                            company: null,
                            location: null,
                            listingUrl: '',
                            description: null,
                            applicationDeadline: null,
                        },
                    ];
                },
            },
        ];
        const completed: string[] = [];
        const errors: string[] = [];
        const repository = {
            upsert: () => 'inserted' as const,
        };

        const result = await runIngestion(
            ['driver', 'dispatcher'],
            providers,
            repository,
            {
                onQuery: (query) => events.push(`query:${query}`),
                onProviderStart: (provider, query) =>
                    events.push(`start:${provider.name}:${query}`),
                onProviderComplete: (provider) =>
                    completed.push(provider.name),
                onProviderError: (provider, query, error) =>
                    errors.push(
                        `${provider.name}:${query}:${error instanceof Error ? error.message : String(error)}`,
                    ),
            },
        );

        assert.deepEqual(result, {
            found: 4,
            added: 0,
            updated: 0,
            skipped: 4,
        });
        assert.deepEqual(errors, [
            'failing:driver:unavailable',
            'failing:dispatcher:unavailable',
        ]);
        assert.deepEqual(completed, ['first', 'last', 'first', 'last']);
        assert.deepEqual(events.filter((event) => event.startsWith('query:')), [
            'query:driver',
            'query:dispatcher',
        ]);
        assert.deepEqual(
            events.filter((event) => event.startsWith('last:')),
            ['last:driver', 'last:dispatcher'],
        );
    });
});
