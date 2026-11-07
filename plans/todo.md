- Refactor incrementally, one well-scoped area at a time. Reduce duplication and remove unused code without splitting the project into unnecessary files. Prioritize clarity and correctness over reducing line count. While you do this, flag if there are parts of the code that seem wrong or could be improved, and make a note to revisit them later. Keep tests that protect important behavior and prevent regressions. Update or add tests when behavior changes; remove tests only when they are redundant, obsolete, or tied to implementation rather than behavior.

Flags:

- Completed: centralized the provider registry and consolidated CLI/server AI evaluation.

- Completed: migration URL fallbacks now warn for invalid legacy URLs and allow unexpected errors to propagate.

- Completed: server database handles now close in `finally` paths, including failed route operations and failed database initialization.

- Completed: shared the query/provider ingestion loop between CLI and server while keeping their logging formats at the entry points.

- Completed: standalone analyzer and evaluator scripts now close databases in `finally` blocks.

- Completed: standalone evaluator now uses the shared job-evaluation workflow.
