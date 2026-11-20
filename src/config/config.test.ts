import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getConfig } from './config.js';

describe('getConfig', () => {
    it('uses defaults and trims search queries', () => {
        const config = getConfig({
            SEARCH_QUERIES: ' lokförare, växlare ,,',
        } as NodeJS.ProcessEnv);

        assert.equal(config.databasePath, './data/jobs.db');
        assert.deepEqual(config.searchQueries, ['lokförare', 'växlare']);
        assert.equal(config.geminiApiKey, null);
    });

    it('falls back to one query when the configured list is empty', () => {
        const config = getConfig({
            SEARCH_QUERIES: ' , ',
            DATABASE_PATH: './tmp/jobs.db',
            GEMINI_API_KEY: 'test-key',
            GEMINI_MODEL: 'test-model',
        } as NodeJS.ProcessEnv);

        assert.equal(config.databasePath, './tmp/jobs.db');
        assert.deepEqual(config.searchQueries, ['lokförare']);
        assert.equal(config.geminiApiKey, 'test-key');
        assert.equal(config.geminiModel, 'test-model');
    });
});
