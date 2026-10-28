# Plan: Combined Scraper and AI Grading Pipeline

## Overview

Permanently combine the job scraping ingestion task and the AI Gemini grading task into a single unified pipeline. This applies to both:

1. **CLI / Daily Automatic Task**: `npm run start` (and `npm run dev`), which will run ingestion across all providers followed immediately by AI grading of all unevaluated jobs.
2. **Web Control Panel (`/control.html`)**: Replaced the separate "Run Scraper" and "AI Evaluator" buttons with a single unified action button: **"Run Scraper & AI Evaluator"**.

## Architecture & Workflow

```mermaid
graph TD
    A[Start: npm run start OR Click Run Pipeline] --> B[Load Config & Database]
    B --> C[Run Job Ingestion from All Providers]
    C --> D[Identify Unevaluated Jobs (aiScore === null)]
    D --> E{Gemini API Key Available?}
    E -->|Yes| F[Evaluate Unevaluated Jobs with Gemini AI]
    E -->|No| G[Log Warning / Skip AI Evaluation]
    F --> H[Update Database with AI Scores & Reasoning]
    G --> H
    H --> I[Complete Pipeline & Close Database]
```

## Detailed Changes

1. **CLI Entrypoint (`src/index.ts`)**:
    - Executes provider ingestion.
    - Immediately checks for `config.geminiApiKey` and evaluates any unevaluated jobs in the database.

2. **Backend API (`src/server.ts`)**:
    - Replaces or updates `/api/ops/run-scraper` (or provides a unified `/api/ops/run-pipeline` endpoint) that executes ingestion and AI grading sequentially in one request, returning combined logs and totals.

3. **Control Panel UI (`public/control.html` & `public/control.js`)**:
    - Removes the separate AI Evaluator card/button.
    - Merges them into a single primary card and button: **"Run Scraper & AI Evaluator"**.
