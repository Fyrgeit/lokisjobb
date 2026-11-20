import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Job } from '../types/job.js';
import { createDatabase } from '../database/database.js';
import { JobsRepository } from '../database/jobs.js';
import { RunHistoryRepository } from '../database/run-history.js';
import {
    evaluateUnevaluatedJobs,
    runEvaluationWithHistory,
    summarizeEvaluationRun,
} from './job-evaluation.js';

function createJob(id: number, aiCategory: Job['aiCategory'] = null): Job {
    return {
        id,
        title: `Job ${id}`,
        company: null,
        location: null,
        canonicalUrl: `https://example.com/jobs/${id}`,
        description: null,
        applicationDeadline: null,
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        aiCategory,
        links: [],
        availability: 'active',
    };
}

describe('evaluateUnevaluatedJobs', () => {
    it('records skipped evaluation history when no API key is configured', async () => {
        const database = createDatabase(':memory:');
        try {
            const repository = new JobsRepository(database);
            const history = new RunHistoryRepository(database);
            const result = await runEvaluationWithHistory(
                history,
                repository,
                null,
                'test-model',
                { log: () => {}, error: () => {} },
            );

            assert.equal(result.evaluatedCount, 0);
            const entries = history.list();
            assert.equal(entries[0]?.status, 'skipped');
            assert.equal(entries[0]?.summary.reason, 'GEMINI_API_KEY saknas');
        } finally {
            database.close();
        }
    });
    it('creates consistent run-history summaries for evaluation operations', () => {
        const summary = {
            totalCount: 5,
            unevaluatedCount: 3,
            evaluatedCount: 2,
            failedCount: 1,
            remainingUnknownCount: 2,
        };

        assert.deepEqual(summarizeEvaluationRun(summary, true), {
            status: 'partial',
            summary: {
                evaluated: 2,
                failed: 1,
                remainingUnknown: 2,
            },
        });
        assert.equal(summarizeEvaluationRun(summary, false).status, 'skipped');
    });
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
