# Terminology Refactor: Providers vs. Sources

## Overview

Currently, the codebase uses the term **"source"** ambiguously to mean two different things:

1. The **scraping integration / job board API client** (e.g., `JobSource`, `ArbetsformedlingenSource`, `src/sources/`).
2. The **origin URL / provenance record** where a job listing was discovered (e.g., `sourceUrl`, `job_sources` table, `job.sources`).

To eliminate confusion, we propose splitting the terminology cleanly:

- **Provider**: The service, site, or API integration that fetches jobs (formerly `JobSource` -> `JobProvider`, `src/sources/` -> `src/providers/`).
- **Source (or Source Link / Provenance)**: The specific URL and metadata record representing where a job was found (retaining terms like `sourceUrl`, `job_sources` table, and `JobSourceRecord` or renaming to `JobSourceLink`).

---

## Proposed Nomenclature Changes

| Current Term               | Proposed Term                         | Description                                                                                              |
| -------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `JobSource`                | `JobProvider`                         | Interface for scraping/fetching jobs from a platform.                                                    |
| `src/sources/`             | `src/providers/`                      | Directory containing provider implementations.                                                           |
| `ArbetsformedlingenSource` | `ArbetsformedlingenProvider`          | Specific provider implementation.                                                                        |
| `source_url`               | `sourceUrl` / `source_url`            | The URL of the job listing on the originating board (remains unchanged as it refers to the source link). |
| `job_sources`              | `job_sources` (or `job_source_links`) | Database table tracking source provenance per job.                                                       |
| `JobSourceRecord`          | `JobSourceLink`                       | Record representing a source reference on a job.                                                         |

---

## Impact & Affected Areas

1. **Types & Interfaces (`src/types/job.ts`)**:
    - Rename `JobSourceRecord` to `JobSourceLink` (optional, or keep if source link is preferred).
2. **Providers (`src/providers/`)**:
    - Rename `src/sources` directory to `src/providers`.
    - Update `JobSource` interface to `JobProvider`.
    - Rename all concrete implementations (`ArbetsformedlingenProvider`, etc.).
3. **Ingestion & Scraper (`src/scraper/ingestion.ts`)**:
    - Update parameter types from `JobSource` to `JobProvider`.
4. **Database (`src/database/jobs.ts`, `src/database/database.ts`)**:
    - Keep columns and tables referencing `source_url` / `job_sources` as they represent the source links/provenance, or clarify via comments.
5. **Analysis & CLI / Server (`src/analysis/`, `src/index.ts`, `src/server.ts`, `src/analyze-sources.ts`)**:
    - Update imports and terminology from sources to providers where appropriate.
