- Refactor incrementally, one well-scoped area at a time. Reduce duplication and remove unused code without splitting the project into unnecessary files. Prioritize clarity and correctness over reducing line count, but reduced size of the project would be appreciated. While you do this, flag if there are parts of the code that seem wrong or could be improved, and make a note to revisit them later. Keep tests that protect important behavior and prevent regressions. Update or add tests when behavior changes; remove tests only when they are redundant, obsolete, or tied to implementation rather than behavior.

Flags:

- Completed: centralized the provider registry and consolidated CLI/server AI evaluation.

- Completed: migration URL fallbacks now warn for invalid legacy URLs and allow unexpected errors to propagate.

- Completed: server database handles now close in `finally` paths, including failed route operations and failed database initialization.

- Completed: shared the query/provider ingestion loop between CLI and server while keeping their logging formats at the entry points.

- Completed: standalone analyzer and evaluator scripts now close databases in `finally` blocks.

- Completed: standalone evaluator now uses the shared job-evaluation workflow.

- Completed: shared duplicate job-link transfer and row-merging helpers between migrations and repository upserts.

- Completed: centralized fetch and AI evaluation run-history summaries for CLI/server reuse.

- Completed: centralized fetch orchestration with run history for CLI/server reuse.

- Completed: centralized AI evaluation orchestration with run history for CLI/server reuse.

- Completed: centralized JSON error response formatting across server routes.

- Completed: centralized whitespace normalization shared by provider parsers.

- Completed: centralized provider HTTP request headers across search, detail, and availability checks.

- Completed: made Jobbland detail-fetch failures warn consistently while preserving search cards.

- Completed: centralized provider detail-fetch failure diagnostics and error formatting.

- Completed: centralized HTML search-fetch and HTTP error handling across providers.

- Completed: centralized JSON search-fetch and HTTP error handling for Arbetsförmedlingen.

- Completed: moved deployment completion JSON validation into the run-history module.

- Completed: reused a single listing-provider set helper in redundancy analysis.

- Completed: removed the redundant JobsRepository merge wrapper and simplified its result shape.

- Completed: consolidated startup duplicate-group merging by canonical and legacy source URL.

- Completed: centralized missing jobs-table column migration checks.

- Completed: shared frontend JSON response and HTML escaping helpers.

- Completed: reused prepared statements in application-link migration.

- Completed: shared database open/close lifecycle across server and standalone entry points.

- Completed: added focused configuration behavior tests.

