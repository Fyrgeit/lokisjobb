import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalizeApplicationUrl } from './ingestion.js';

describe('canonicalizeApplicationUrl', () => {
    it('removes syndicated application tracking parameters', () => {
        assert.equal(
            canonicalizeApplicationUrl(
                'https://jobb.sj.se/jobs/8247962-fordonsoperator?promotion=2154712-arbetsformedlingen&utm_source=jobbsafari.se',
            ),
            'https://jobb.sj.se/jobs/8247962-fordonsoperator',
        );
    });
});
