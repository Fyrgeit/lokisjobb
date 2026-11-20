import type { JobsRepository } from '../database/jobs.js';
import {
    RunHistoryRepository,
    withRunHistory,
    type RunCompletion,
} from '../database/run-history.js';
import { evaluateJobWithGemini } from './gemini-evaluator.js';

type JobEvaluationRepository = Pick<
    JobsRepository,
    'list' | 'updateAiCategory'
>;

interface JobEvaluationLogger {
    log(message: string): void;
    error(message: string): void;
}

export interface JobEvaluationSummary {
    totalCount: number;
    unevaluatedCount: number;
    evaluatedCount: number;
    failedCount: number;
    remainingUnknownCount: number;
}

export function summarizeEvaluationRun(
    result: JobEvaluationSummary,
    apiKeyConfigured: boolean,
): Omit<RunCompletion, 'durationMs' | 'completedAt'> {
    return {
        status: !apiKeyConfigured
            ? 'skipped'
            : result.failedCount > 0
              ? 'partial'
              : 'success',
        summary: {
            evaluated: result.evaluatedCount,
            failed: result.failedCount,
            remainingUnknown: result.remainingUnknownCount,
            ...(!apiKeyConfigured
                ? { reason: 'GEMINI_API_KEY saknas' }
                : {}),
        },
    };
}

export async function runEvaluationWithHistory(
    history: RunHistoryRepository,
    repository: JobEvaluationRepository,
    apiKey: string | null | undefined,
    model: string,
    logger: JobEvaluationLogger,
    evaluate: typeof evaluateJobWithGemini = evaluateJobWithGemini,
): Promise<JobEvaluationSummary> {
    return withRunHistory(
        history,
        'ai_classification',
        () => {
            if (!apiKey) {
                const jobs = repository.list();
                logger.log(
                    'Hoppar över AI-klassificeringen: GEMINI_API_KEY är inte konfigurerad.',
                );
                return Promise.resolve({
                    totalCount: jobs.length,
                    unevaluatedCount: jobs.filter(
                        (job) => job.aiCategory === null,
                    ).length,
                    evaluatedCount: 0,
                    failedCount: 0,
                    remainingUnknownCount: jobs.filter(
                        (job) => job.aiCategory === null,
                    ).length,
                });
            }
            return evaluateUnevaluatedJobs(
                repository,
                apiKey,
                model,
                logger,
                evaluate,
            );
        },
        (result) => summarizeEvaluationRun(result, Boolean(apiKey)),
    );
}

export async function evaluateUnevaluatedJobs(
    repository: JobEvaluationRepository,
    apiKey: string | null | undefined,
    model: string,
    logger: JobEvaluationLogger,
    evaluate: typeof evaluateJobWithGemini = evaluateJobWithGemini,
): Promise<JobEvaluationSummary> {
    const jobs = repository.list();
    const unevaluatedJobs = jobs.filter((job) => job.aiCategory === null);
    logger.log(
        `Börjar klassificera ${unevaluatedJobs.length} okategoriserade jobb av ${jobs.length} totalt.`,
    );

    let evaluatedCount = 0;
    let failedCount = 0;

    if (!apiKey) {
        logger.log(
            'Hoppar över AI-klassificeringen: GEMINI_API_KEY är inte konfigurerad.',
        );
    } else {
        for (const job of unevaluatedJobs) {
            logger.log(
                `Klassificerar jobb #${job.id}: "${job.title}" hos ${job.company ?? 'okänt företag'}...`,
            );
            try {
                const { category } = await evaluate(job, apiKey, model);
                repository.updateAiCategory(job.id, category);
                logger.log(` -> Kategori: ${category}`);
                evaluatedCount++;
            } catch (error: unknown) {
                failedCount++;
                logger.error(
                    `Det gick inte att klassificera jobb #${job.id}: ${error instanceof Error ? error.message : error}`,
                );
            }
        }
    }

    const remainingUnknownCount = repository
        .list()
        .filter((job) => job.aiCategory === null).length;

    return {
        totalCount: jobs.length,
        unevaluatedCount: unevaluatedJobs.length,
        evaluatedCount,
        failedCount,
        remainingUnknownCount,
    };
}
