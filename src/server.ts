import express from 'express';
import path from 'node:path';
import { getJobs } from './list-jobs.js';
import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import type Database from 'better-sqlite3';
import { evaluateUnevaluatedJobs } from './evaluator/job-evaluation.js';
import { createProviders } from './providers/create-providers.js';
import { runIngestion } from './scraper/run-ingestion.js';
import { analyzeProviderRedundancy } from './analysis/provider-redundancy.js';
import {
    RunHistoryRepository,
    withRunHistory,
} from './database/run-history.js';

const app = express();
const PORT = 3000;

async function withDatabase<T>(
    databasePath: string,
    operation: (database: Database.Database) => T | Promise<T>,
): Promise<T> {
    const database = createDatabase(databasePath);
    try {
        return await operation(database);
    } finally {
        database.close();
    }
}

app.use(express.json());
// Serve everything in /public
app.use(express.static(path.join(process.cwd(), 'public')));

function createOpsLogStream(res: express.Response) {
    res.status(200).type('application/x-ndjson');
    res.flushHeaders();

    const send = (event: Record<string, unknown>) => {
        res.write(`${JSON.stringify(event)}\n`);
    };

    return {
        log(message: string) {
            console.log(message);
            send({ type: 'log', message });
        },
        complete(result: Record<string, unknown>) {
            send({ type: 'result', ...result });
            res.end();
        },
        fail(error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(error);
            send({ type: 'error', message });
            res.end();
        },
    };
}

async function runScraperIngestion(
    searchQueries: string[],
    repository: JobsRepository,
    log: (message: string) => void,
) {
    let failedProviderQueries = 0;
    const totals = await runIngestion(
        searchQueries,
        createProviders(),
        repository,
        {
            onQuery: (query) => log(`--- Söker efter: "${query}" ---`),
            onProviderStart: (provider, query) =>
                log(`Söker efter "${query}" hos ${provider.name}...`),
            onProviderComplete: (provider, _query, summary) =>
                log(
                    `[${provider.name}] Hittade ${summary.found}, lade till ${summary.added}, uppdaterade ${summary.updated}`,
                ),
            onProviderError: (provider, query, error) => {
                failedProviderQueries += 1;
                log(
                    `[${provider.name}] Misslyckades för sökningen "${query}": ${error instanceof Error ? error.message : error}`,
                );
            },
        },
    );
    return { totals, failedProviderQueries };
}

// Existing API endpoint for dashboard jobs
app.get('/api/jobs', (_req, res) => {
    res.json(getJobs());
});

app.get('/api/ops/history', async (_req, res) => {
    try {
        const config = getConfig();
        const entries = await withDatabase(config.databasePath, (database) =>
            new RunHistoryRepository(database).list(),
        );
        res.json({ entries });
    } catch (error: unknown) {
        res.status(500).json({
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

// Database stats endpoint
app.get('/api/database/stats', async (_req, res) => {
    try {
        const config = getConfig();
        const stats = await withDatabase(config.databasePath, (db) => {
            const jobCountRow = db
                .prepare('SELECT COUNT(*) as count FROM jobs')
                .get() as { count: number };
            const listingLinkCountRow = db
                .prepare(
                    "SELECT COUNT(*) as count FROM job_links WHERE link_kind = 'listing'",
                )
                .get() as { count: number };

            const providersSummary = db
                .prepare(
                    "SELECT provider_name, COUNT(*) as count FROM job_links WHERE link_kind = 'listing' GROUP BY provider_name",
                )
                .all();

            return {
                totalJobs: jobCountRow.count,
                totalListingLinks: listingLinkCountRow.count,
                providersBreakdown: providersSummary,
                databasePath: config.databasePath,
            };
        });

        res.json(stats);
    } catch (error: unknown) {
        res.status(500).json({
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

// Database table inspector endpoint
app.get('/api/database/tables/:tableName', async (req, res) => {
    const { tableName } = req.params;
    if (
        tableName !== 'jobs' &&
        tableName !== 'job_links'
    ) {
        res.status(400).json({
            error: 'Ogiltigt tabellnamn. Tillåtna tabeller: jobs, job_links',
        });
        return;
    }

    try {
        const config = getConfig();
        const rows = await withDatabase(config.databasePath, (db) =>
            db.prepare(`SELECT * FROM ${tableName} LIMIT 100`).all(),
        );

        res.json({ table: tableName, rows });
    } catch (error: unknown) {
        res.status(500).json({
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

app.delete('/api/database', async (_req, res) => {
    try {
        const config = getConfig();
        const result = await withDatabase(config.databasePath, (database) => {
            const clearJobs = database.transaction(() => {
                const deletedJobs = (
                    database
                        .prepare('SELECT COUNT(*) AS count FROM jobs')
                        .get() as { count: number }
                ).count;
                const deletedLinks = (
                    database
                        .prepare('SELECT COUNT(*) AS count FROM job_links')
                        .get() as { count: number }
                ).count;

                database.prepare('DELETE FROM jobs').run();
                return { deletedJobs, deletedLinks };
            });

            return clearJobs();
        });

        res.json(result);
    } catch (error: unknown) {
        res.status(500).json({
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

// Run Scraper & AI Evaluator Pipeline Operation
app.post('/api/ops/run-scraper', async (_req, res) => {
    const stream = createOpsLogStream(res);
    const log = stream.log;

    try {
        const config = getConfig();
        const result = await withDatabase(config.databasePath, async (database) => {
            const repository = new JobsRepository(database);
            const history = new RunHistoryRepository(database);
            const fetchResult = await withRunHistory(
                history,
                'fetch',
                () =>
                    runScraperIngestion(
                        config.searchQueries,
                        repository,
                        log,
                    ),
                (result) => ({
                    status:
                        result.failedProviderQueries > 0
                            ? 'partial'
                            : 'success',
                    summary: {
                        source: 'Alla källor',
                        found: result.totals.found,
                        added: result.totals.added,
                        updated: result.totals.updated,
                        skipped: result.totals.skipped,
                        failed: result.failedProviderQueries,
                    },
                }),
            );
            const totals = fetchResult.totals;

            log(`--- Hämtning – totalt ---`);
            log(
                `Hittade totalt: ${totals.found}, tillagda: ${totals.added}, uppdaterade: ${totals.updated}`,
            );
            log(`\n--- AI-klassificering ---`);
            const evaluation = await withRunHistory(
                history,
                'ai_classification',
                () =>
                    evaluateUnevaluatedJobs(
                        repository,
                        config.geminiApiKey,
                        config.geminiModel,
                        { log, error: log },
                    ),
                (result) => ({
                    status: !config.geminiApiKey
                        ? 'skipped'
                        : result.failedCount > 0
                          ? 'partial'
                          : 'success',
                    summary: {
                        evaluated: result.evaluatedCount,
                        failed: result.failedCount,
                        remainingUnknown: result.remainingUnknownCount,
                    },
                }),
            );
            log(
                `AI-klassificeringen är klar. Klassificerade: ${evaluation.evaluatedCount}, misslyckade: ${evaluation.failedCount}, återstående okategoriserade: ${evaluation.remainingUnknownCount}.`,
            );
            return { totals, evaluation };
        });

        stream.complete({
            success: true,
            totals: result.totals,
            evaluatedCount: result.evaluation.evaluatedCount,
        });
    } catch (error: unknown) {
        stream.fail(error);
    }
});

// Run Scraper Operation
app.post('/api/ops/run-scraper-only', async (_req, res) => {
    const stream = createOpsLogStream(res);
    const log = stream.log;

    try {
        const config = getConfig();
        const totals = await withDatabase(config.databasePath, (database) =>
            withRunHistory(
                new RunHistoryRepository(database),
                'fetch',
                () =>
                    runScraperIngestion(
                        config.searchQueries,
                        new JobsRepository(database),
                        log,
                    ),
                (result) => ({
                    status:
                        result.failedProviderQueries > 0
                            ? 'partial'
                            : 'success',
                    summary: {
                        source: 'Alla källor',
                        found: result.totals.found,
                        added: result.totals.added,
                        updated: result.totals.updated,
                        skipped: result.totals.skipped,
                        failed: result.failedProviderQueries,
                    },
                }),
            ),
        );

        log('--- Hämtning – totalt ---');
        log(
            `Hittade totalt: ${totals.totals.found}, tillagda: ${totals.totals.added}, uppdaterade: ${totals.totals.updated}`,
        );

        stream.complete({ success: true, totals: totals.totals });
    } catch (error: unknown) {
        stream.fail(error);
    }
});

// Run Evaluator (AI Gemini) Operation
app.post('/api/ops/run-evaluator', async (_req, res) => {
    let stream: ReturnType<typeof createOpsLogStream> | undefined;

    try {
        const config = getConfig();
        if (!config.geminiApiKey) {
            await withDatabase(config.databasePath, (database) =>
                withRunHistory(
                    new RunHistoryRepository(database),
                    'ai_classification',
                    async () => null,
                    () => ({
                        status: 'skipped',
                        summary: {
                            evaluated: 0,
                            failed: 0,
                            reason: 'GEMINI_API_KEY saknas',
                        },
                    }),
                ),
            );
            res.status(400).json({
                success: false,
                error: 'Miljövariabeln GEMINI_API_KEY måste anges.',
            });
            return;
        }

        stream = createOpsLogStream(res);
        const log = stream.log;
        const evaluation = await withDatabase(config.databasePath, (database) =>
            withRunHistory(
                new RunHistoryRepository(database),
                'ai_classification',
                () =>
                    evaluateUnevaluatedJobs(
                        new JobsRepository(database),
                        config.geminiApiKey,
                        config.geminiModel,
                        { log, error: log },
                    ),
                (result) => ({
                    status: result.failedCount > 0 ? 'partial' : 'success',
                    summary: {
                        evaluated: result.evaluatedCount,
                        failed: result.failedCount,
                        remainingUnknown: result.remainingUnknownCount,
                    },
                }),
            ),
        );
        log(
            `Klassificeringen är klar. Klassificerade: ${evaluation.evaluatedCount}, misslyckade: ${evaluation.failedCount}, återstående okategoriserade: ${evaluation.remainingUnknownCount}.`,
        );
        stream.complete({
            success: true,
            evaluatedCount: evaluation.evaluatedCount,
        });
    } catch (error: unknown) {
        if (stream) {
            stream.fail(error);
        } else {
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
});

// Run Redundancy Analyzer Operation
app.post('/api/ops/run-analyzer', async (_req, res) => {
    try {
        const config = getConfig();
        const report = await withDatabase(config.databasePath, (database) =>
            analyzeProviderRedundancy(new JobsRepository(database).list()),
        );

        res.json({ success: true, report });
    } catch (error: unknown) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

app.listen(PORT, () => {
    console.log(`Lokisjobb körs på http://localhost:${PORT}`);
});
