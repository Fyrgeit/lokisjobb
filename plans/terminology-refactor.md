# Job Links and Provider Terminology

The model distinguishes the service that finds a vacancy from the URLs
associated with that vacancy:

- **Provider**: The API or website integration that searches for jobs
  (`JobProvider`).
- **Listing link**: The provider's page for the vacancy. Its availability and
  first/last-seen timestamps are tracked per provider.
- **Application link**: A destination for applying, which may be on Jobylon,
  EasyApply, Visma, or another service. It does not determine listing
  availability.
- **Canonical URL**: The job's deduplication identity. Ingestion uses a web
  application URL when available and otherwise falls back to the listing URL.

Providers return `ScrapedJob` values with separate `listingUrl` and optional
`applicationUrl` fields. The persisted `Job.links` array is backed by the
normalized `job_links` table; listing and application links are distinguished
by their `kind`. Provider coverage analysis uses listing links only.

The database migration renames the legacy `jobs.url` column to
`jobs.canonical_url`, moves `jobs.source_url` and `job_sources` records into
`job_links`, then removes the redundant legacy column and table.
