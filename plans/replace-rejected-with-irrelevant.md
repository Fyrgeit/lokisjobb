# Plan: Replace Rejected Status with Irrelevant

This plan outlines the steps to replace the [`JobStatus`](src/types/job.ts:1) `'rejected'` with `'irrelevant'` when an AI evaluation score is 0.

## Overview of Changes

1. [`src/types/job.ts`](src/types/job.ts:1): Update [`JobStatus`](src/types/job.ts:1) type definition from `'new' | 'interested' | 'rejected' | 'applied'` to `'new' | 'interested' | 'irrelevant' | 'applied'`.
2. [`src/database/jobs.ts`](src/database/jobs.ts:240): Update [`JobRepository.updateAiScore()`](src/database/jobs.ts:240) to assign `'irrelevant'` instead of `'rejected'` when `aiScore === 0`.
3. [`public/index.html`](public/index.html:181) & [`public/index.js`](public/index.js:176): Update UI filter options and status colors from `rejected` to `irrelevant`.
4. [`src/database/jobs.test.ts`](src/database/jobs.test.ts:142) & [`src/analysis/provider-redundancy.test.ts`](src/analysis/provider-redundancy.test.ts:125): Update test assertions expecting `'rejected'` to expect `'irrelevant'`.

## Architecture Flow

```mermaid
graph TD
    A[`src/evaluate-jobs.ts`](src/evaluate-jobs.ts:1) -->|Score = 0| B[`src/database/jobs.ts`](src/database/jobs.ts:240)
    B -->|Status = irrelevant| C[`Job Database`](src/database/database.ts:1)
    C -->|API Response| D[`public/index.js`](public/index.js:1)
    D -->|Badge & Filter| E[`User Dashboard`](public/index.html:1)
```

## Architectural Consideration: Combining Status and Availability

It is **not** recommended to combine the [`status`](src/types/job.ts:1) and [`availability`](src/types/job.ts:2) fields into a single field:

- **[`status`](src/types/job.ts:1)** (`'new'`, `'interested'`, `'irrelevant'`, `'applied'`) tracks the user's personal workflow intent and AI evaluation decision.
- **[`availability`](src/types/job.ts:2)** (`'active'`, `'closed'`, `'unknown'`) tracks external listing state detected by scrapers.

Coupling them would cause conflicts—for instance, an [`'interested'`](src/types/job.ts:1) job can become [`'closed'`](src/types/job.ts:2) on the source website, or an [`'irrelevant'`](src/types/job.ts:1) job may still be active. Keeping them decoupled preserves clean separation of concerns.
