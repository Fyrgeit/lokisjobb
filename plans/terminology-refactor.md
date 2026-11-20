# Job Links and Provider Terminology

**Status: Completed**

The model distinguishes the service that finds a vacancy from the URLs
associated with that vacancy:

- **Provider**: The API or website integration that searches for jobs
  (`JobProvider`).
- **Listing link**: The provider's page for the vacancy. Its availability and
  first/last-seen timestamps are tracked per provider.
- **Application link**: A destination for applying, which may be on Jobylon,
  EasyApply, Visma, or another service. It does not determine listing
  availability.
- **Canonical URL**: An optional web application destination. It is not the
  job's identity; records use their internal ID, and a missing application
  destination remains `null` rather than falling back to a listing URL.

Providers return `ScrapedJob` values with separate `listingUrl` and optional
`applicationUrl` fields. The persisted `Job.links` array is backed by the
normalized `job_links` table; listing and application links are distinguished
by their `kind`. Provider coverage analysis uses listing links only. Listings
from different providers may merge when their employer, title, deadline, and
description strongly match.

The database migration renames the legacy `jobs.url` column to
`jobs.canonical_url`, moves `jobs.source_url` and `job_sources` records into
`job_links`, then removes the redundant legacy column and table.
