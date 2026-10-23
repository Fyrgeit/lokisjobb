export interface Config {
    databasePath: string;
    searchQueries: string[];
    geminiApiKey: string | null;
    geminiModel: string;
}

// Keep configuration deliberately small: this application is local, so the
// environment only needs to control where data is stored and what to search.
export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const rawQueries = env.SEARCH_QUERIES ?? env.SEARCH_QUERY ?? 'lokförare,växlare';
    const searchQueries = rawQueries
        .split(',')
        .map((q) => q.trim())
        .filter(Boolean);
    return {
        databasePath: env.DATABASE_PATH ?? './data/jobs.db',
        searchQueries: searchQueries.length > 0 ? searchQueries : ['lokförare'],
        geminiApiKey: env.GEMINI_API_KEY ?? null,
        geminiModel: env.GEMINI_MODEL ?? 'google/gemini-3.5-flash-lite',
    };
}
