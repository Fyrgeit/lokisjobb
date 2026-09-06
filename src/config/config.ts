export interface Config {
  databasePath: string;
  searchQuery: string;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databasePath: env.DATABASE_PATH ?? "./data/jobs.db",
    searchQuery: env.SEARCH_QUERY ?? "lokförare"
  };
}
