# Lokisjobb

Lokisjobb is a local TypeScript foundation for finding and evaluating job listings. It currently includes a source for the public job listing page at jarnvagsjobb.se.

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

To try the Indeed adapter:

```powershell
$env:JOB_SOURCE = "indeed"
npm run dev
```

Indeed may return a browser security check instead of job HTML. The adapter
reports that clearly; it does not attempt to bypass the check. Järnvägsjobb is
the default source.

To use Jobbsafari:

```powershell
$env:JOB_SOURCE = "jobbsafari"
npm run dev
```

To use Jobbland:

```powershell
$env:JOB_SOURCE = "jobbland"
npm run dev
```

To use Platsbanken through Arbetsförmedlingen's public JobTech API:

```powershell
$env:JOB_SOURCE = "arbetsformedlingen"
npm run dev
```

On Windows PowerShell:

```powershell
$env:DATABASE_PATH = ".\\data\\jobs.db"
$env:SEARCH_QUERY = "lokförare"
npm run dev
```

Other commands:

```bash
npm run jobs
npm test
npm run build
npm start
npm run lint
```

`npm run jobs` reads the persisted jobs from SQLite and prints them as text. Set
`DATABASE_PATH` first if the database is stored somewhere other than
`data/jobs.db`.

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

- `src/sources/` contains source-specific fetching and parsing. Sources return `ScrapedJob` values and do not know about SQLite. `JarnvagsjobbSource` reads jarnvagsjobb.se, `IndeedSource` parses Indeed result cards when the site provides accessible HTML, `ArbetsformedlingenSource` uses the public JobTech API behind Platsbanken, `JobbsafariSource` reads Jobbsafari's embedded search data and detail pages, and `JobblandSource` reads Jobbland search cards and detail pages.
- `src/scraper/ingestion.ts` validates source results and connects a source to the repository.
- `src/database/` initializes SQLite and owns job persistence, including URL-based deduplication.
- `src/types/job.ts` contains the normalized scraped and persisted job types.
- `application_deadline` stores the source-provided latest application date when available.
- AI evaluation is intentionally not implemented. A future evaluator can read persisted jobs and update `ai_score` through the repository.

## Adding a job source

1. Create a module in `src/sources/` implementing `JobSource`.
2. Fetch the source and map its results to `ScrapedJob` objects.
3. Use that source with `ingestFromSource` in the application entry point.

The source should keep all website-specific selectors or API parsing inside its own module and should never import the database layer.

The Järnvägsjobb source reads titles, companies, locations, deadlines, and links from the listing page, then fetches each detail page for the full job description. If an individual detail page cannot be fetched, the listing is still stored and a warning is printed. Detail pages are fetched sequentially to keep the scraper simple and polite.
