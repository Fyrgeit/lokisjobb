# Lokisjobb

Lokisjobb is a local TypeScript foundation for finding and evaluating job listings. The initial version uses a mock source to demonstrate the complete flow without depending on a specific job website.

## Prerequisites

- Node.js 20 or newer
- npm

## Install and run

```bash
npm install
npm run dev
```

The default database is `data/jobs.db`. To use another path or query, set environment variables before running:

```bash
DATABASE_PATH=./data/jobs.db SEARCH_QUERY="lokförare" npm run dev
```

On Windows PowerShell:

```powershell
$env:DATABASE_PATH = ".\\data\\jobs.db"
$env:SEARCH_QUERY = "lokförare"
npm run dev
```

Other commands:

```bash
npm test
npm run build
npm start
npm run lint
```

Running the application more than once updates `last_seen_at` for the same URLs instead of creating duplicate rows. The SQLite database itself is ignored by Git.

## Architecture

```text
JobSource.search(query)
        |
        v
  ScrapedJob[]
        |
        v
  ingestion service
        |
        v
  JobsRepository
        |
        v
     SQLite
```

- `src/sources/` contains source-specific fetching and parsing. Sources return `ScrapedJob` values and do not know about SQLite.
- `src/scraper/ingestion.ts` validates source results and connects a source to the repository.
- `src/database/` initializes SQLite and owns job persistence, including URL-based deduplication.
- `src/types/job.ts` contains the normalized scraped and persisted job types.
- AI evaluation is intentionally not implemented. A future evaluator can read persisted jobs and update `ai_score` through the repository.

## Adding a job source

1. Create a module in `src/sources/` implementing `JobSource`.
2. Fetch the source and map its results to `ScrapedJob` objects.
3. Use that source with `ingestFromSource` in the application entry point.

The source should keep all website-specific selectors or API parsing inside its own module and should never import the database layer.
