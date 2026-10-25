# Plan: Sorting Enhancements (Time Found and Application Deadline)

This plan outlines the enhancements to sort jobs by recency (time found / [`discoveredAt`](src/types/job.ts:1)) and last application date / deadline ([`applicationDeadline`](src/types/job.ts:1)).

## Overview of Changes

1. [`public/index.html`](public/index.html:218): Add sorting options for Application Deadline (`deadline-asc` for soonest deadline, `deadline-desc` for latest deadline).
2. [`public/index.js`](public/index.js:128): Implement comparison logic in sorting for `deadline-asc` and `deadline-desc` using `job.applicationDeadline`.
3. Clean up obsolete [`plans/replace-rejected-with-irrelevant.md`](plans/replace-rejected-with-irrelevant.md:1).

## Sorting Logic Design

- **Time Found (Recency)**: Already supported via `discovered-desc` (Newest first) and `discovered-asc` (Oldest first) using [`discoveredAt`](src/types/job.ts:1).
- **Application Deadline**:
    - `deadline-asc`: Sort by [`applicationDeadline`](src/types/job.ts:1) ascending (soonest deadline first, handling nulls/empty dates appropriately at the end).
    - `deadline-desc`: Sort by [`applicationDeadline`](src/types/job.ts:1) descending (latest deadline first).
