# Expanded Searching and Gemini LLM Job Evaluation Plan

## Overview
Expand `lokisjobb` to support wider multi-term searching (e.g., capturing related roles like `växlare`, `konduktör`, `lokförare`) while filtering and ranking relevance automatically using Gemini 3.5 Flash Lite (`google/gemini-3.5-flash-lite`).

## 1. Multi-Query / Wider Searching
- **Configuration**: Update `Config` and `.env` handling to support `SEARCH_QUERIES` (comma-separated list of search terms, e.g., `lokförare,växlare,tågmästare`).
- **Ingestion**: Update `src/index.ts` / ingestion loop to iterate through each search query across all active job sources, deduplicating naturally via `JobsRepository.upsert` (canonical URL / source URL identity).

## 2. Gemini 3.5 Flash Lite Evaluation & Ranking
- **Evaluator Service (`src/evaluator/gemini-evaluator.ts`)**:
  - Connects to Gemini API using `GEMINI_API_KEY` and model `google/gemini-3.5-flash-lite`.
  - Sends job metadata (`title`, `company`, `location`, `description`) along with user intent/criteria.
  - Receives a relevance score between `0.0` and `1.0` and brief reasoning.
- **Database & Repository Integration**:
  - Uses existing `jobs.ai_score` column and `repository.updateAiScore(id, score)`.
- **Evaluation Workflow**:
  - Add a CLI command (`npm run evaluate`) or post-ingestion step to evaluate unevaluated or newly discovered jobs (`ai_score IS NULL`).

## 3. UI & CLI Presentation
- **CLI (`src/list-jobs.ts`)** & **Web UI (`public/`)**:
  - Display `aiScore` prominently.
  - Allow sorting and filtering by AI score so high-relevance jobs (including newly captured wider search terms like `växlare`) float to the top.

## 4. Validation & Testing
- Unit tests with mocked Gemini API responses to ensure prompt formatting, score parsing, and repository updates function correctly.
