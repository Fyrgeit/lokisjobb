import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProviders } from './create-providers.js';

describe('createProviders', () => {
    it('returns providers in the established search order', () => {
        assert.deepEqual(
            createProviders().map((provider) => provider.name),
            [
                'jarnvagsjobb.se',
                'arbetsformedlingen.se',
                'jobbland.se',
                'jobbsafari.se',
            ],
        );
    });
});
