const statTotalJobs = document.getElementById('statTotalJobs');
const statTotalSources = document.getElementById('statTotalSources');
const statDbPath = document.getElementById('statDbPath');

const runScraperBtn = document.getElementById('runScraperBtn');
const runScraperOnlyBtn = document.getElementById('runScraperOnlyBtn');
const runEvaluatorBtn = document.getElementById('runEvaluatorBtn');
const runAnalyzerBtn = document.getElementById('runAnalyzerBtn');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const terminalOutput = document.getElementById('terminalOutput');

const tableSelect = document.getElementById('tableSelect');
const refreshTableBtn = document.getElementById('refreshTableBtn');
const inspectorTable = document.getElementById('inspectorTable');
const inspectorBody = document.getElementById('inspectorBody');

function appendLog(text, isError = false) {
    const time = new Date().toLocaleTimeString();
    const prefix = `[${time}] `;
    terminalOutput.textContent += `${prefix}${text}\n`;
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

clearLogsBtn.addEventListener('click', () => {
    terminalOutput.textContent = 'Console cleared.\n';
});

async function parseResponse(res) {
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(
            `Server returned non-JSON response (${res.status} ${res.statusText}): ${text.slice(0, 150)}`,
        );
    }
    if (!res.ok) {
        throw new Error(
            data.error ||
                data.message ||
                `HTTP error ${res.status} ${res.statusText}`,
        );
    }
    return data;
}

async function consumeOperationStream(res) {
    if (!res.ok) {
        await parseResponse(res);
        throw new Error(`HTTP error ${res.status} ${res.statusText}`);
    }
    if (!res.body) {
        throw new Error('Server response does not support streaming.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result;

    function processLine(line) {
        if (!line.trim()) return;

        let event;
        try {
            event = JSON.parse(line);
        } catch {
            throw new Error(`Invalid operation stream event: ${line}`);
        }

        if (event.type === 'log') {
            appendLog(event.message);
        } else if (event.type === 'result') {
            result = event;
        } else if (event.type === 'error') {
            throw new Error(event.message);
        } else {
            throw new Error(`Unknown operation stream event: ${event.type}`);
        }
    }

    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        const lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(processLine);

        if (done) break;
    }
    processLine(buffer);

    if (!result) {
        throw new Error('Operation stream ended without a result.');
    }
    return result;
}

async function fetchStats() {
    try {
        const res = await fetch('/api/database/stats');
        const data = await parseResponse(res);
        if (data.totalJobs !== undefined) {
            statTotalJobs.textContent = data.totalJobs;
            statTotalSources.textContent = data.totalSourceRecords;
            statDbPath.textContent = data.databasePath;
        }
    } catch (err) {
        appendLog(`Failed to fetch database stats: ${err.message}`, true);
    }
}

async function runScraper() {
    runScraperBtn.disabled = true;
    runScraperBtn.textContent = 'Running Scraper & AI Evaluator...';
    appendLog('Starting job scraper ingestion and AI evaluation pipeline...');

    try {
        const res = await fetch('/api/ops/run-scraper', { method: 'POST' });
        const data = await consumeOperationStream(res);
        if (data.success) {
            appendLog(
                `Pipeline completed successfully. Found: ${data.totals.found}, Added: ${data.totals.added}, Updated: ${data.totals.updated}, Evaluated: ${data.evaluatedCount}`,
            );
        } else {
            appendLog(`Pipeline failed: ${data.error}`, true);
        }
        fetchStats();
    } catch (err) {
        appendLog(`Pipeline request failed: ${err.message}`, true);
    } finally {
        runScraperBtn.disabled = false;
        runScraperBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Run Scraper & AI Evaluator`;
    }
}

async function runScraperOnly() {
    runScraperOnlyBtn.disabled = true;
    runScraperOnlyBtn.querySelector('span').textContent = 'Running Scraper...';
    appendLog('Starting job scraper ingestion...');

    try {
        const res = await fetch('/api/ops/run-scraper-only', { method: 'POST' });
        const data = await consumeOperationStream(res);
        if (data.success) {
            appendLog(
                `Scraper completed successfully. Found: ${data.totals.found}, Added: ${data.totals.added}, Updated: ${data.totals.updated}`,
            );
            fetchStats();
        } else {
            appendLog(`Scraper failed: ${data.error}`, true);
        }
    } catch (err) {
        appendLog(`Scraper request failed: ${err.message}`, true);
    } finally {
        runScraperOnlyBtn.disabled = false;
        runScraperOnlyBtn.querySelector('span').textContent = 'Run Scraper';
    }
}

async function runEvaluator() {
    runEvaluatorBtn.disabled = true;
    runEvaluatorBtn.querySelector('span').textContent = 'Running AI Evaluator...';
    appendLog('Starting AI evaluation of unevaluated jobs...');

    try {
        const res = await fetch('/api/ops/run-evaluator', { method: 'POST' });
        const data = await consumeOperationStream(res);
        if (data.success) {
            appendLog(
                `AI evaluation completed successfully. Evaluated: ${data.evaluatedCount}`,
            );
            fetchStats();
        } else {
            appendLog(`AI evaluation failed: ${data.error}`, true);
        }
    } catch (err) {
        appendLog(`AI evaluator request failed: ${err.message}`, true);
    } finally {
        runEvaluatorBtn.disabled = false;
        runEvaluatorBtn.querySelector('span').textContent = 'Run AI Evaluator';
    }
}

async function runAnalyzer() {
    runAnalyzerBtn.disabled = true;
    runAnalyzerBtn.textContent = 'Analyzing Providers...';
    appendLog('Running provider redundancy analysis...');

    try {
        const res = await fetch('/api/ops/run-analyzer', { method: 'POST' });
        const data = await parseResponse(res);
        if (data.success && data.report) {
            const r = data.report;
            appendLog(`=== Provider Redundancy Analysis Report ===`);
            appendLog(`Total Unique Jobs: ${r.totalUniqueJobs}`);
            r.sources.forEach((s) => {
                const tag = s.noExclusiveJobs ? ' [no exclusive jobs]' : '';
                appendLog(
                    `• Provider: ${s.name} | Total Jobs: ${s.totalJobs} (${s.coveragePercentage}%) | Exclusive: ${s.exclusiveJobs}${tag}`,
                );
            });
            if (r.minimalCovers.length > 0) {
                appendLog(
                    `Top Minimal Cover: [ ${r.minimalCovers[0].sources.join(', ')} ] -> ${r.minimalCovers[0].coveragePercentage}% coverage`,
                );
            }
        } else {
            appendLog(`Analyzer failed: ${data.error}`, true);
        }
    } catch (err) {
        appendLog(`Analyzer request failed: ${err.message}`, true);
    } finally {
        runAnalyzerBtn.disabled = false;
        runAnalyzerBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg> Run Analyzer`;
    }
}

async function loadTableInspector() {
    const tableName = tableSelect.value;
    appendLog(`Loading table "${tableName}" into inspector...`);

    try {
        const res = await fetch(`/api/database/tables/${tableName}`);
        const data = await parseResponse(res);

        if (data.error) {
            appendLog(`Error loading table: ${data.error}`, true);
            return;
        }

        const rows = data.rows || [];
        if (rows.length === 0) {
            inspectorTable.querySelector('thead').innerHTML =
                `<tr><th class="p-3">No records found in ${tableName}</th></tr>`;
            inspectorBody.innerHTML = `<tr><td class="p-4 text-slate-500 text-center">Table is empty.</td></tr>`;
            return;
        }

        const columns = Object.keys(rows[0]);
        inspectorTable.querySelector('thead').innerHTML = `
            <tr>
                ${columns.map((c) => `<th class="p-3 border-b border-slate-700">${c}</th>`).join('')}
            </tr>
        `;

        inspectorBody.innerHTML = rows
            .map(
                (row) => `
            <tr class="hover:bg-slate-900">
                ${columns
                    .map((c) => {
                        const val = row[c];
                        const displayVal =
                            val !== null && val !== undefined
                                ? String(val)
                                : '<span class="text-slate-600">NULL</span>';
                        return `<td class="p-3 truncate max-w-xs" title="${displayVal !== '<span class="text-slate-600">NULL</span>' ? displayVal.replace(/"/g, '"') : ''}">${displayVal}</td>`;
                    })
                    .join('')}
            </tr>
        `,
            )
            .join('');

        appendLog(`Loaded ${rows.length} rows from table "${tableName}".`);
    } catch (err) {
        appendLog(`Failed to load table inspector: ${err.message}`, true);
    }
}

runScraperBtn.addEventListener('click', runScraper);
runScraperOnlyBtn.addEventListener('click', runScraperOnly);
runEvaluatorBtn.addEventListener('click', runEvaluator);
runAnalyzerBtn.addEventListener('click', runAnalyzer);
refreshTableBtn.addEventListener('click', loadTableInspector);

// Initial load
fetchStats();
loadTableInspector();
