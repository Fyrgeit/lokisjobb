I am building a local personal job-search agent called **Lokisjobb**.

The application will primarily be used to find and evaluate job listings, including railway jobs such as **lokförare**, but it should not be hard-coded around railway jobs. It should be possible to add arbitrary job-search sources and search terms later.

Build the initial project foundation in **Node.js + TypeScript**.

## Core architectural principles

Keep the architecture simple and modular. This is a personal/local application, not a SaaS product.

Important principles:

1. Scraping/fetching a job source must be separate from database code.
2. Individual job sources must produce a common normalized `Job` object.
3. The scraper must not directly manipulate SQLite.
4. Database operations should be isolated behind a small repository/data-access layer.
5. Do not introduce unnecessary frameworks or infrastructure.
6. Do not use PostgreSQL, Redis, Docker, microservices, or a web server unless there is a concrete reason.
7. The application should run entirely locally.
8. Prefer straightforward TypeScript over elaborate abstractions.
9. Make the project easy to run on both Windows and Linux.
10. Do not implement the AI scoring system yet. Leave a clean place for it to be added later.

## Initial technology choices

Use:

- Node.js
- TypeScript
- SQLite
- npm
- Git

Choose a sensible, actively maintained SQLite package for Node.js. Prefer a package with good TypeScript support and simple synchronous or straightforward asynchronous database access.

Use `tsx` or an equivalent simple TypeScript runner for development.

Use ESLint and a reasonable TypeScript configuration.

Do not add a frontend yet.

## Project structure

Create a structure approximately like:

src/
index.ts
types/
job.ts
database/
database.ts
jobs.ts
sources/
...
scraper/
...
config/
...

The exact structure can be adjusted if there is a clearly better simple arrangement, but keep responsibilities separated.

Create a `data/` directory for the SQLite database.

The database file should NOT be committed to Git.

Add an appropriate `.gitignore`.

## Job data model

The initial job entity is deliberately small.

A job contains:

- `id`
- `title`
- `company`
- `location`
- `url`
- `description`
- `discovered_at`
- `last_seen_at`
- `ai_score`
- `status`

Use appropriate TypeScript types.

For example, timestamps should have a consistent representation. ISO 8601 strings are fine.

`ai_score` should be nullable because a job may not have been evaluated yet.

`status` should initially support at least:

- `new`
- `interested`
- `rejected`
- `applied`

Do not add companies, applications, contacts, CVs, users, authentication, etc. to the database yet. Those may be added later if needed.

## SQLite schema

Create a `jobs` table equivalent to:

CREATE TABLE jobs (
id INTEGER PRIMARY KEY,
title TEXT NOT NULL,
company TEXT,
location TEXT,
url TEXT UNIQUE,
description TEXT,
discovered_at TEXT NOT NULL,
last_seen_at TEXT NOT NULL,
ai_score REAL,
status TEXT NOT NULL DEFAULT 'new'
);

Enable foreign keys if they become relevant later, but do not create unnecessary tables now.

Create an index on fields that are likely to be searched frequently if appropriate, but don't prematurely optimize.

## Database layer

Create a small jobs repository/data-access module.

It should eventually support operations such as:

- insert a new job
- find a job by URL
- update an existing job's `last_seen_at`
- retrieve jobs
- update `ai_score`
- update `status`

For now, implement the minimum needed to demonstrate the complete ingestion flow.

Most importantly, implement **upsert/deduplication by URL**.

When a scraper encounters a job:

### If the URL does not exist:

Insert a new row.

Set:

- `discovered_at` = current time
- `last_seen_at` = current time
- `status` = `new`
- `ai_score` = NULL

### If the URL already exists:

Do NOT create another job.

Update:

- `last_seen_at`

Do NOT automatically overwrite:

- `discovered_at`
- `ai_score`
- `status`

The reason is that the same job may be encountered every time the scraper runs, while my own state and AI evaluation should persist.

## Normalized job type

Create a TypeScript type/interface representing a job returned by a source.

Separate the database ID from the scraped job data if appropriate.

For example, conceptually:

type ScrapedJob = {
title: string;
company: string | null;
location: string | null;
url: string;
description: string | null;
};

The ingestion/database layer can add timestamps and database-specific fields.

Do not make individual scrapers aware of SQLite.

## Job source architecture

I want multiple job sources eventually.

Create a simple interface for a job source, something conceptually like:

interface JobSource {
name: string;
search(query: string): Promise<ScrapedJob[]>;
}

Do not over-engineer this interface.

A source should:

1. receive a search query
2. fetch the relevant website/API
3. parse the results
4. return normalized `ScrapedJob` objects

It should not:

- insert into SQLite
- calculate AI scores
- modify job status
- know anything about the rest of the application

## First scraper

For the first scraper, create a clear placeholder/example source rather than attempting to support every job site immediately.

If a real source can be implemented easily and legally using a public API or publicly accessible job-search endpoint, structure the project so that source can be added cleanly.

Otherwise create a `MockJobSource` that returns several realistic example jobs.

The important thing at this stage is proving the architecture:

JobSource
→ ScrapedJob[]
→ ingestion
→ SQLite
→ deduplication

Do not build a complicated scraping framework yet.

If implementing an actual website scraper, isolate all website-specific selectors/parsing logic inside that source's module.

## Ingestion service

Create a small ingestion service responsible for taking jobs from a source and storing them.

Conceptually:

source.search(query)
↓
ScrapedJob[]
↓
Job ingestion service
↓
SQLite jobs repository

The ingestion service should be the only layer that connects the source layer to the database layer.

It should handle:

- normalization if necessary
- deduplication
- insertion
- updating `last_seen_at`

Return useful information about the run, such as:

- number of jobs found
- number of new jobs
- number of existing jobs updated
- number of invalid jobs skipped

Keep this simple.

## Configuration

Create a simple configuration mechanism using environment variables where appropriate.

For example:

DATABASE_PATH=./data/jobs.db

Do not create a complicated configuration system.

Provide a `.env.example` if environment variables are used.

Do not commit actual secrets.

## Logging

Add simple readable logging for development.

For example:

Starting job search...
Found 23 jobs
Added 8 new jobs
Updated 15 existing jobs

Do not introduce a logging framework unless necessary.

## Error handling

A failure from one job source should be represented clearly and should not corrupt the database.

Keep error handling straightforward.

Do not silently swallow errors.

## CLI / running the application

The project should be runnable with npm scripts such as:

npm run dev

npm run build

npm start

If useful, add a simple command for running a test ingestion/search.

The initial application should demonstrate the complete flow when run:

1. Initialize/create the SQLite database.
2. Run the example/mock source.
3. Retrieve jobs.
4. Insert new jobs.
5. Update `last_seen_at` for existing jobs.
6. Print a short summary.
7. Exit cleanly.

Running it a second time should demonstrate that duplicate jobs are not created.

## Testing

Add a small test suite for the most important database behavior.

At minimum test:

1. A new job is inserted.
2. The same URL does not create a duplicate.
3. `last_seen_at` is updated when an existing job is encountered.
4. `discovered_at` is not changed for an existing job.
5. `status` is not overwritten during re-ingestion.
6. `ai_score` is not overwritten during re-ingestion.

Keep tests local and simple. Use a temporary/in-memory SQLite database where practical.

## AI architecture

Do NOT implement AI functionality yet.

However, structure the project so that later we can add something like:

Scraped jobs
↓
Database
↓
AI evaluator
↓
ai_score

The AI evaluator should eventually be a separate module/service that receives a job and returns structured evaluation data.

Do not call an LLM during the initial implementation.

## Future direction

The eventual application may include:

- multiple job sources
- scheduled searches
- configurable search queries
- AI relevance scoring
- extraction of job requirements
- personalized matching against my skills/preferences
- notifications
- a UI for browsing jobs
- tracking my interaction with jobs

Do not implement these yet.

Design the foundation so they can be added without rewriting the scraper/database architecture.

## Code quality

Keep the code:

- idiomatic TypeScript
- simple
- readable
- modular
- easy to debug
- cross-platform

Avoid:

- unnecessary design patterns
- dependency injection frameworks
- excessive interfaces
- premature abstraction
- unnecessary classes
- complicated folder structures

Prefer small functions and modules with obvious responsibilities.

## Deliverables

After creating the project, provide:

1. The complete initial project structure.
2. All required source files.
3. `package.json`.
4. TypeScript configuration.
5. ESLint configuration if used.
6. `.gitignore`.
7. `.env.example` if needed.
8. SQLite initialization/schema.
9. Database repository.
10. `JobSource` interface.
11. Mock/example source.
12. Ingestion service.
13. Basic tests.
14. A README explaining:
    - prerequisites
    - installation
    - how to run
    - how the architecture works
    - how to add another job source

Do not merely generate pseudocode. Create a **working initial project** that I can install and run immediately.

Before adding any additional technology or feature not explicitly requested above, favor the simplest solution and explain the reason briefly.
