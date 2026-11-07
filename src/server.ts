import express from 'express';
import path from 'node:path';
import { getJobs } from './list-jobs.js';
import { getConfig } from './config/config.js';
import { createDatabase } from './database/database.js';
import { JobsRepository } from './database/jobs.js';
import { evaluateUnevaluatedJobs } from './evaluator/job-evaluation.js';
import { createProviders } from './providers/create-providers.js';
import { ingestFromSource } from './scraper/ingestion.js';
import { analyzeProviderRedundancy } from './analysis/provider-redundancy.js';

const app = express();
const PORT = 3000;

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
    const providers = createProviders();
    const totals = { found: 0, added: 0, updated: 0, skipped: 0 };

    for (const query of searchQueries) {
        log(`--- Söker efter: "${query}" ---`);
        for (const provider of providers) {
            try {
                log(
                    `Söker efter "${query}" hos ${provider.name}...`,
                );
                const summary = await ingestFromSource(
                    provider,
                    query,
                    repository,
                );
                totals.found += summary.found;
                totals.added += summary.added;
                totals.updated += summary.updated;
                totals.skipped += summary.skipped;
                log(
                    `[${provider.name}] Hittade ${summary.found}, lade till ${summary.added}, uppdaterade ${summary.updated}`,
                );
            } catch (error: unknown) {
                log(
                    `[${provider.name}] Misslyckades för sökningen "${query}": ${error instanceof Error ? error.message : error}`,
                );
            }
        }
    }

    return totals;
}

// Existing API endpoint for dashboard jobs
app.get('/api/jobs', (_req, res) => {
    res.json(getJobs());
});

// Database stats endpoint
app.get('/api/database/stats', (_req, res) => {
    try {
        const config = getConfig();
        const db = createDatabase(config.databasePath);

        const jobCountRow = db
            .prepare('SELECT COUNT(*) as count FROM jobs')
            .get() as { count: number };
        const sourceCountRow = db
            .prepare('SELECT COUNT(*) as count FROM job_sources')
            .get() as { count: number };

        const sourcesSummary = db
            .prepare(
                'SELECT source_name, COUNT(*) as count FROM job_sources GROUP BY source_name',
            )
            .all();

        db.close();

        res.json({
            totalJobs: jobCountRow.count,
            totalSourceRecords: sourceCountRow.count,
            sourcesBreakdown: sourcesSummary,
            databasePath: config.databasePath,
        });
    } catch (error: unknown) {
        res.status(500).json({
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

// Database table inspector endpoint
app.get('/api/database/tables/:tableName', (req, res) => {
    const { tableName } = req.params;
    if (tableName !== 'jobs' && tableName !== 'job_sources') {
        res.status(400).json({
            error: 'Ogiltigt tabellnamn. Tillåtna tabeller: jobs, job_sources',
        });
        return;
    }

    try {
        const config = getConfig();
        const db = createDatabase(config.databasePath);
        const rows = db.prepare(`SELECT * FROM ${tableName} LIMIT 100`).all();
        db.close();

        res.json({ table: tableName, rows });
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
        const database = createDatabase(config.databasePath);
        const repository = new JobsRepository(database);
        const totals = await runScraperIngestion(
            config.searchQueries,
            repository,
            log,
        );

        log(`--- Hämtning – totalt ---`);
        log(
            `Hittade totalt: ${totals.found}, tillagda: ${totals.added}, uppdaterade: ${totals.updated}`,
        );

        // Run AI Evaluation
        log(`\n--- AI-klassificering ---`);
        const evaluation = await evaluateUnevaluatedJobs(
            repository,
            config.geminiApiKey,
            config.geminiModel,
            { log, error: log },
        );
        log(
            `AI-klassificeringen är klar. Klassificerade: ${evaluation.evaluatedCount}, misslyckade: ${evaluation.failedCount}, återstående okategoriserade: ${evaluation.remainingUnknownCount}.`,
        );

        database.close();

        stream.complete({
            success: true,
            totals,
            evaluatedCount: evaluation.evaluatedCount,
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
        const database = createDatabase(config.databasePath);
        const repository = new JobsRepository(database);
        const totals = await runScraperIngestion(
            config.searchQueries,
            repository,
            log,
        );
        database.close();

        log('--- Hämtning – totalt ---');
        log(
            `Hittade totalt: ${totals.found}, tillagda: ${totals.added}, uppdaterade: ${totals.updated}`,
        );

        stream.complete({ success: true, totals });
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
            res.status(400).json({
                success: false,
                error: 'Miljövariabeln GEMINI_API_KEY måste anges.',
            });
            return;
        }

        stream = createOpsLogStream(res);
        const log = stream.log;
        const database = createDatabase(config.databasePath);
        const repository = new JobsRepository(database);
        const evaluation = await evaluateUnevaluatedJobs(
            repository,
            config.geminiApiKey,
            config.geminiModel,
            { log, error: log },
        );
        database.close();
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
app.post('/api/ops/run-analyzer', (_req, res) => {
    try {
        const config = getConfig();
        const db = createDatabase(config.databasePath);
        const repo = new JobsRepository(db);
        const jobs = repo.list();
        const report = analyzeProviderRedundancy(jobs);
        db.close();

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
