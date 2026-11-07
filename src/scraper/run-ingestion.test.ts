import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JobProvider } from '../providers/job-provider.js';
import { runIngestion } from './run-ingestion.js';

describe('runIngestion', () => {
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
                            url: '',
                            sourceUrl: '',
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
                            url: '',
                            sourceUrl: '',
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
