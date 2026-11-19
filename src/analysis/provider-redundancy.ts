import type { Job } from '../types/job.js';

export interface ProviderStats {
    name: string;
    totalJobs: number;
    exclusiveJobs: number;
    coveragePercentage: number;
    noExclusiveJobs: boolean;
}

export interface ProviderCombinationResult {
    providers: string[];
    coversAll: boolean;
    coveragePercentage: number;
}

export interface RedundancyAnalysisReport {
    totalUniqueJobs: number;
    providers: ProviderStats[];
    minimalCovers: ProviderCombinationResult[];
}

export function analyzeProviderRedundancy(
    jobs: Job[],
): RedundancyAnalysisReport {
    const validJobs = jobs.filter(
        (job) => job.aiCategory !== 'Ointressant',
    );
    const totalUniqueJobs = validJobs.length;
    if (totalUniqueJobs === 0) {
        return {
            totalUniqueJobs: 0,
            providers: [],
            minimalCovers: [],
        };
    }

    const providerNamesSet = new Set<string>();
    for (const job of validJobs) {
        for (const link of job.links) {
            if (link.kind === 'listing') {
                providerNamesSet.add(link.provider);
            }
        }
    }
    const providerNames = [...providerNamesSet].sort();

    const providerStatsMap = new Map<
        string,
        { total: number; exclusive: number }
    >();
    for (const name of providerNames) {
        providerStatsMap.set(name, { total: 0, exclusive: 0 });
    }

    for (const job of validJobs) {
        const jobProviders = new Set(
            job.links
                .filter((link) => link.kind === 'listing')
                .map((link) => link.provider),
        );

        for (const name of jobProviders) {
            const stats = providerStatsMap.get(name)!;
            stats.total += 1;
        }

        if (jobProviders.size === 1) {
            const [exclusiveName] = [...jobProviders];
            const stats = providerStatsMap.get(exclusiveName);
            if (stats) {
                stats.exclusive += 1;
            }
        }
    }

    const providers: ProviderStats[] = providerNames.map((name) => {
        const stats = providerStatsMap.get(name)!;
        return {
            name,
            totalJobs: stats.total,
            exclusiveJobs: stats.exclusive,
            coveragePercentage: Number(
                ((stats.total / totalUniqueJobs) * 100).toFixed(1),
            ),
            noExclusiveJobs: stats.exclusive === 0,
        };
    });

    // Find minimal provider combinations that achieve full coverage.
    const minimalCovers: ProviderCombinationResult[] = [];

    const combinations = getCombinations(providerNames);
    combinations.sort((a, b) => a.length - b.length);

    let minSizeFound = Infinity;
    for (const combo of combinations) {
        if (combo.length > minSizeFound) {
            break; // We already found shorter valid combinations
        }

        let coveredCount = 0;
        for (const job of validJobs) {
            const jobProviders = new Set(
                job.links
                    .filter((link) => link.kind === 'listing')
                    .map((link) => link.provider),
            );
            const isCovered = combo.some((provider) =>
                jobProviders.has(provider),
            );
            if (isCovered) {
                coveredCount += 1;
            }
        }

        const coveragePercentage = Number(
            ((coveredCount / totalUniqueJobs) * 100).toFixed(1),
        );
        const coversAll = coveredCount === totalUniqueJobs;

        if (coversAll) {
            minSizeFound = combo.length;
            minimalCovers.push({
                providers: combo,
                coversAll,
                coveragePercentage,
            });
        }
    }

    return {
        totalUniqueJobs,
        providers,
        minimalCovers,
    };
}

function getCombinations<T>(arr: T[]): T[][] {
    const result: T[][] = [];
    const f = (prefix: T[], rest: T[]) => {
        for (let i = 0; i < rest.length; i++) {
            const nextPrefix = [...prefix, rest[i]];
            result.push(nextPrefix);
            f(nextPrefix, rest.slice(i + 1));
        }
    };
    f([], arr);
    return result;
}
