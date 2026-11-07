import { ArbetsformedlingenProvider } from './arbetsformedlingen-provider.js';
import { JarnvagsjobbProvider } from './jarnvagsjobb-provider.js';
import { JobblandProvider } from './jobbland-provider.js';
import { JobbsafariProvider } from './jobbsafari-provider.js';
import type { JobProvider } from './job-provider.js';

export function createProviders(): JobProvider[] {
    return [
        new JarnvagsjobbProvider(),
        new ArbetsformedlingenProvider(),
        new JobblandProvider(),
        new JobbsafariProvider(),
    ];
}
