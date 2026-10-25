import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { evaluateJobWithGemini } from './gemini-evaluator.js';
import type { Job } from '../types/job.js';

describe('evaluateJobWithGemini', () => {
    it('correctly parses evaluation score and reasoning from Gemini response', async () => {
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
            aiScore: null,
            status: 'interested',
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
                                            score: 0.95,
                                            reasoning: 'Directly relates to railway shunting (växlare).',
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

        assert.equal(result.score, 0.95);
        assert.equal(result.reasoning, 'Directly relates to railway shunting (växlare).');
        assert.equal(mockFetch.mock.callCount(), 1);
    });
});
