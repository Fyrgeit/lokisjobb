# Lokisjobb

Lokisjobb is a local TypeScript foundation for finding and evaluating job listings. It currently includes a source for the public job listing page at jarnvagsjobb.se.

## Prerequisites

- Node.js 20 or newer
- npm

## Install and run

`npm run dev` searches every configured source in sequence. Each source gets
its own summary and totals are printed at the end. A source failure is reported
and skipped so it does not stop the other sources.

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

Jobs use `url` as the canonical application destination for deduplication. The
`job_sources` table stores every listing or detail page where the job was found,
including each source's first and latest sighting times. Known Jobylon URL
variants are normalized to the same vacancy identity, so syndicated listings
from multiple sources converge without losing provenance.

Availability is separate from your personal job `status`. Each source is
tracked as `active`, `closed`, or `unknown`; a job is `closed` only when all
known sources report it closed. Closed jobs remain stored for history and are
not automatically marked `rejected`.

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

- `src/sources/` contains source-specific fetching and parsing. Sources return `ScrapedJob` values and do not know about SQLite. `JarnvagsjobbSource` reads jarnvagsjobb.se, `ArbetsformedlingenSource` uses the public JobTech API behind Platsbanken, `JobbsafariSource` reads Jobbsafari's embedded search data and detail pages, and `JobblandSource` reads Jobbland search cards and detail pages.
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
