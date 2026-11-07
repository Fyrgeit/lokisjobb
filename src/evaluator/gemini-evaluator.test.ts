import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { evaluateJobWithGemini } from './gemini-evaluator.js';
import type { Job } from '../types/job.js';

describe('evaluateJobWithGemini', () => {
    it('parses one category from Gemini without a rationale', async () => {
        const mockJob: Job = {
            id: 1,
            title: 'Tågväxlare',
            company: 'Green Cargo',
            location: 'Hallsberg',
            url: 'https://example.com/job/1',
            description: 'Arbete som växlare på rangeringsbangård.',
            applicationDeadline: null,
            discoveredAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: '2026-01-01T00:00:00.000Z',
            aiCategory: null,
            availability: 'active',
            sources: [],
        };

        const mockFetch = mock.fn(async () => {
            return new Response(
                JSON.stringify({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        text: JSON.stringify({
                                            category: 'Växlare',
                                        }),
                                    },
                                ],
                            },
                        },
                    ],
                }),
                { status: 200 },
            );
        });

        global.fetch = mockFetch as unknown as typeof fetch;

        const result = await evaluateJobWithGemini(mockJob, 'fake-api-key');

        assert.deepEqual(result, { category: 'Växlare' });
        assert.equal(mockFetch.mock.callCount(), 1);
    });

    it('rejects categories outside the configured list', async () => {
        const mockJob: Job = {
            id: 1,
            title: 'Truck driver',
            company: null,
            location: null,
            url: 'https://example.com/job/2',
            description: null,
            applicationDeadline: null,
            discoveredAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: '2026-01-01T00:00:00.000Z',
            aiCategory: null,
            availability: 'active',
            sources: [],
        };
        global.fetch = mock.fn(async () => new Response(
            JSON.stringify({
                candidates: [{
                    content: {
                        parts: [{ text: JSON.stringify({ category: 'Maybe' }) }],
                    },
                }],
            }),
            { status: 200 },
        )) as unknown as typeof fetch;

        await assert.rejects(
            evaluateJobWithGemini(mockJob, 'fake-api-key'),
            /Gemini API returnerade en ogiltig kategori/,
        );
    });

    it('rejects Okänd because it represents an unevaluated job, not an AI result', async () => {
        const mockJob: Job = {
            id: 1,
            title: 'Unknown job',
            company: null,
            location: null,
            url: 'https://example.com/job/3',
            description: null,
            applicationDeadline: null,
            discoveredAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: '2026-01-01T00:00:00.000Z',
            aiCategory: null,
            availability: 'active',
            sources: [],
        };
        global.fetch = mock.fn(async () => new Response(
            JSON.stringify({
                candidates: [{
                    content: {
                        parts: [{ text: JSON.stringify({ category: 'Okänd' }) }],
                    },
                }],
            }),
            { status: 200 },
        )) as unknown as typeof fetch;

        await assert.rejects(
            evaluateJobWithGemini(mockJob, 'fake-api-key'),
            /Gemini API returnerade en ogiltig kategori/,
        );
    });
});
