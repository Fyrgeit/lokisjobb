import type { Job } from '../types/job.js';

export interface SourceStats {
    name: string;
    totalJobs: number;
    exclusiveJobs: number;
    coveragePercentage: number;
    noExclusiveJobs: boolean;
}

export interface SourceCombinationResult {
    sources: string[];
    coversAll: boolean;
    coveragePercentage: number;
}

export interface RedundancyAnalysisReport {
    totalUniqueJobs: number;
    sources: SourceStats[];
    minimalCovers: SourceCombinationResult[];
}

export function analyzeSourceRedundancy(jobs: Job[]): RedundancyAnalysisReport {
    const validJobs = jobs.filter((job) => job.aiScore !== 0);
    const totalUniqueJobs = validJobs.length;
    if (totalUniqueJobs === 0) {
        return {
            totalUniqueJobs: 0,
            sources: [],
            minimalCovers: [],
        };
    }

    // Collect all unique source names
    const sourceNamesSet = new Set<string>();
    for (const job of validJobs) {
        for (const source of job.sources) {
            sourceNamesSet.add(source.name);
        }
    }
    const sourceNames = [...sourceNamesSet].sort();

    // Calculate stats per source
    const sourceStatsMap = new Map<
        string,
        { total: number; exclusive: number }
    >();
    for (const name of sourceNames) {
        sourceStatsMap.set(name, { total: 0, exclusive: 0 });
    }

    for (const job of validJobs) {
        const jobSourceNames = new Set(job.sources.map((s) => s.name));

        for (const name of jobSourceNames) {
            const stats = sourceStatsMap.get(name)!;
            stats.total += 1;
        }

        // Exclusive if exactly 1 source name contributed to this job
        if (jobSourceNames.size === 1) {
            const [exclusiveName] = [...jobSourceNames];
            const stats = sourceStatsMap.get(exclusiveName);
            if (stats) {
                stats.exclusive += 1;
            }
        }
    }

    const sources: SourceStats[] = sourceNames.map((name) => {
        const stats = sourceStatsMap.get(name)!;
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

    // Find minimal source combinations that achieve 100% (or maximum possible) coverage
    const minimalCovers: SourceCombinationResult[] = [];

    // Generate power set or test combinations (since number of sources is typically small, e.g. <= 10)
    const combinations = getCombinations(sourceNames);
    // Sort combinations by size ascending
    combinations.sort((a, b) => a.length - b.length);

    let minSizeFound = Infinity;
    for (const combo of combinations) {
        if (combo.length > minSizeFound) {
            break; // We already found shorter valid combinations
        }

        let coveredCount = 0;
        for (const job of validJobs) {
            const jobSourceNames = new Set(job.sources.map((s) => s.name));
            const isCovered = combo.some((src) => jobSourceNames.has(src));
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
                sources: combo,
                coversAll,
                coveragePercentage,
            });
        }
    }

    return {
        totalUniqueJobs,
        sources,
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
