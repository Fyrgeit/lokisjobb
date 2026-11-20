import express from 'express';
import path from 'node:path';
import { getJobs } from './list-jobs.js';
import { getConfig } from './config/config.js';
import { withDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import {
    runEvaluationWithHistory,
} from './evaluator/job-evaluation.js';
import { createProviders } from './providers/create-providers.js';
import {
    runFetchWithHistory,
} from './scraper/run-ingestion.js';
import { analyzeProviderRedundancy } from './analysis/provider-redundancy.js';
import {
    RunHistoryRepository,
} from './database/run-history.js';

const app = express();
const PORT = 3000;


function sendJsonError(
    res: express.Response,
    status: number,
    error: unknown,
    includeSuccess = false,
): void {
    res.status(status).json({
        ...(includeSuccess ? { success: false } : {}),
        error: error instanceof Error ? error.message : String(error),
    });
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
    history: RunHistoryRepository,
    log: (message: string) => void,
) {
    return runFetchWithHistory(
        history,
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
                log(
                    `[${provider.name}] Misslyckades för sökningen "${query}": ${error instanceof Error ? error.message : error}`,
                );
            },
        },
    );
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
        sendJsonError(res, 500, error);
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
        sendJsonError(res, 500, error);
    }
});

// Database table inspector endpoint
app.get('/api/database/tables/:tableName', async (req, res) => {
    const { tableName } = req.params;
    if (
        tableName !== 'jobs' &&
        tableName !== 'job_links'
    ) {
        sendJsonError(
            res,
            400,
            'Ogiltigt tabellnamn. Tillåtna tabeller: jobs, job_links',
        );
        return;
    }

    try {
        const config = getConfig();
        const rows = await withDatabase(config.databasePath, (db) =>
            db.prepare(`SELECT * FROM ${tableName} LIMIT 100`).all(),
        );

        res.json({ table: tableName, rows });
    } catch (error: unknown) {
        sendJsonError(res, 500, error);
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
        sendJsonError(res, 500, error);
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
            const fetchResult = await runScraperIngestion(
                config.searchQueries,
                repository,
                history,
                log,
            );
            const totals = fetchResult.totals;

            log(`--- Hämtning – totalt ---`);
            log(
                `Hittade totalt: ${totals.found}, tillagda: ${totals.added}, uppdaterade: ${totals.updated}`,
            );
            log(`\n--- AI-klassificering ---`);
            const evaluation = await runEvaluationWithHistory(
                history,
                repository,
                config.geminiApiKey,
                config.geminiModel,
                { log, error: log },
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
            runScraperIngestion(
                config.searchQueries,
                new JobsRepository(database),
                new RunHistoryRepository(database),
                log,
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
                runEvaluationWithHistory(
                    new RunHistoryRepository(database),
                    new JobsRepository(database),
                    null,
                    config.geminiModel,
                    { log: () => {}, error: () => {} },
                ),
            );
            sendJsonError(
                res,
                400,
                'Miljövariabeln GEMINI_API_KEY måste anges.',
                true,
            );
            return;
        }

        stream = createOpsLogStream(res);
        const log = stream.log;
        const evaluation = await withDatabase(config.databasePath, (database) =>
            runEvaluationWithHistory(
                new RunHistoryRepository(database),
                new JobsRepository(database),
                config.geminiApiKey,
                config.geminiModel,
                { log, error: log },
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
            sendJsonError(res, 500, error, true);
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
        sendJsonError(res, 500, error, true);
    }
});

app.listen(PORT, () => {
    console.log(`Lokisjobb körs på http://localhost:${PORT}`);
});
