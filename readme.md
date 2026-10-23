# Lokisjobb

Lokisjobb is a robust local TypeScript foundation for finding, ingesting, analyzing, and evaluating job listings from multiple Swedish job sources.

## Supported Sources

- **Järnvägsjobb**: Scrapes listings and detail pages from `jarnvagsjobb.se`.
- **Arbetsförmedlingen**: Queries the public JobTech API behind Platsbanken.
- **Jobbland**: Scrapes job cards and detail pages from `jobbland.se`.
- **Jobbsafari**: Reads embedded search data and detail pages from `jobbsafari.se`.

## Prerequisites

- Node.js 20 or newer
- npm

## Install and Run

Install dependencies:

```bash
npm install
```

### Available Scripts

- `npm run dev`: Scrapes and ingests job listings from all configured sources in sequence.
- `npm run server`: Starts the Express web server (`http://localhost:3000`) serving the UI and API (`/api/jobs`).
- `npm run jobs`: Reads persisted jobs from SQLite and prints them as text.
- `npm run evaluate`: Evaluates unevaluated jobs using Google Gemini (`GEMINI_API_KEY` required).
- `npm run analyze`: Runs source redundancy and coverage analysis on persisted jobs.
- `npm test`: Runs test suites across the codebase.
- `npm run build`: Compiles TypeScript files (`tsc`).
- `npm start`: Runs the compiled production build.
- `npm run lint`: Lints the codebase with ESLint.

On Windows PowerShell:

```powershell
$env:DATABASE_PATH = ".\\data\\jobs.db"
$env:SEARCH_QUERY = "lokförare"
$env:GEMINI_API_KEY = "your-api-key"
npm run dev
```

## Key Features

1. **Deduplication & Provenance**: Jobs use canonical `url` as the primary deduplication key. The `job_sources` table tracks every source listing where a job appeared, recording first and latest sighting times. Known Jobylon URL variants are automatically normalized so syndicated listings converge without losing provenance.
2. **Availability Tracking**: Each source connection tracks availability as `active`, `closed`, or `unknown`. A job is marked `closed` only when all known sources report it closed. Closed jobs are retained for historical analysis.
3. **AI Evaluation (Gemini)**: Leverages Google Gemini to evaluate job postings against custom criteria, storing `ai_score` and reasoning in the database.
4. **Source Redundancy Analysis**: Analyzes overlap, exclusive job coverage, and minimal source combinations needed for 100% market coverage.
5. **Web Interface & API**: Express backend serving a local frontend interface in `public/` for inspecting and viewing jobs.

## Architecture

```text
JobSource.search(query)
        |
        v
  ScrapedJob[]
        |
        v
  ingestion service (validation & normalization)
        |
        v
  JobsRepository (SQLite persistence & deduplication)
        |
        +---> Analysis / Redundancy Analyzer
        +---> Gemini AI Evaluator
        +---> Express Web Server (/api/jobs)
```

- `src/sources/`: Source-specific fetching, parsing, and normalization implementing `JobSource`.
- `src/scraper/`: Ingestion service validating and storing scraped jobs into the repository.
- `src/database/`: SQLite database initialization (`database.ts`) and repository (`jobs.ts`) handling persistence and deduplication.
- `src/evaluator/`: Google Gemini AI job evaluation logic (`gemini-evaluator.ts`).
- `src/analysis/`: Source redundancy and coverage overlap algorithms (`source-redundancy.ts`).
- `src/server.ts`: Express API server powering the local web interface (`public/`).
- `src/types/job.ts`: Normalized scraped and persisted job data types.

## Adding a Job Source

1. Create a new module in `src/sources/` implementing the `JobSource` interface.
2. Fetch the source and map results to `ScrapedJob` objects.
3. Register the new source in the ingestion pipeline (`src/index.ts`).

Sources encapsulate all website-specific scraping/API logic and never directly import the database layer.
