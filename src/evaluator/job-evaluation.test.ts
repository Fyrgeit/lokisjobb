import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Job } from '../types/job.js';
import { evaluateUnevaluatedJobs } from './job-evaluation.js';

function createJob(id: number, aiCategory: Job['aiCategory'] = null): Job {
    return {
        id,
        title: `Job ${id}`,
        company: null,
        location: null,
        url: `https://example.com/jobs/${id}`,
        description: null,
        applicationDeadline: null,
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        aiCategory,
        sources: [],
        availability: 'active',
    };
}

describe('evaluateUnevaluatedJobs', () => {
    it('evaluates unevaluated jobs and reports failures and remaining jobs', async () => {
        const jobs = [createJob(1), createJob(2), createJob(3, 'Godståg')];
        const loggerOutput: string[] = [];
        const updatedCategories = new Map<number, Job['aiCategory']>();
        const repository = {
            list: () =>
                jobs.map((job) => ({
                    ...job,
                    aiCategory: updatedCategories.get(job.id) ?? job.aiCategory,
                })),
            updateAiCategory: (
                id: number,
                category: NonNullable<Job['aiCategory']>,
            ) =>
                updatedCategories.set(id, category),
        };

        const summary = await evaluateUnevaluatedJobs(
            repository,
            'api-key',
            'test-model',
            {
                log: (message) => loggerOutput.push(message),
                error: (message) => loggerOutput.push(message),
            },
            async (job) => {
                if (job.id === 2) {
                    throw new Error('test failure');
                }
                return { category: 'Persontåg' };
            },
        );

        assert.deepEqual(summary, {
            totalCount: 3,
            unevaluatedCount: 2,
            evaluatedCount: 1,
            failedCount: 1,
            remainingUnknownCount: 1,
        });
        assert.equal(updatedCategories.get(1), 'Persontåg');
        assert.equal(updatedCategories.has(2), false);
        assert.ok(loggerOutput.some((message) => message.includes('test failure')));
    });

    it('skips evaluation when no API key is configured', async () => {
        const repository = {
            list: () => [createJob(1)],
            updateAiCategory: () => assert.fail('should not evaluate jobs'),
        };
        const loggerOutput: string[] = [];

        const summary = await evaluateUnevaluatedJobs(
            repository,
            undefined,
            'test-model',
            {
                log: (message) => loggerOutput.push(message),
                error: (message) => loggerOutput.push(message),
            },
            async () => assert.fail('should not call the evaluator'),
        );

        assert.equal(summary.unevaluatedCount, 1);
        assert.equal(summary.remainingUnknownCount, 1);
        assert.ok(loggerOutput.some((message) => message.includes('Hoppar över')));
    });
});
