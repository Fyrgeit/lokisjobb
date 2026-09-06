export interface Config {
    databasePath: string;
    searchQuery: string;
    jobSource: 'jarnvagsjobb' | 'indeed' | 'arbetsformedlingen';
}

// Keep configuration deliberately small: this application is local, so the
// environment only needs to control where data is stored and what to search.
export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
    return {
        databasePath: env.DATABASE_PATH ?? './data/jobs.db',
        searchQuery: env.SEARCH_QUERY ?? 'lokförare',
        jobSource:
            env.JOB_SOURCE === 'indeed'
                ? 'indeed'
                : env.JOB_SOURCE === 'arbetsformedlingen'
                  ? 'arbetsformedlingen'
                  : 'jarnvagsjobb',
    };
}
