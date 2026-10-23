const statTotalJobs = document.getElementById('statTotalJobs');
const statTotalSources = document.getElementById('statTotalSources');
const statDbPath = document.getElementById('statDbPath');

const runScraperBtn = document.getElementById('runScraperBtn');
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
    runScraperBtn.textContent = 'Running Scraper...';
    appendLog('Starting job scraper ingestion across all providers...');

    try {
        const res = await fetch('/api/ops/run-scraper', { method: 'POST' });
        const data = await parseResponse(res);
        if (data.logs) {
            data.logs.forEach((l) => appendLog(l));
        }
        if (data.success) {
            appendLog(
                `Scraper completed successfully. Found: ${data.totals.found}, Added: ${data.totals.added}, Updated: ${data.totals.updated}`,
            );
        } else {
            appendLog(`Scraper failed: ${data.error}`, true);
        }
        fetchStats();
    } catch (err) {
        appendLog(`Scraper request failed: ${err.message}`, true);
    } finally {
        runScraperBtn.disabled = false;
        runScraperBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Run Scraper`;
    }
}

async function runEvaluator() {
    runEvaluatorBtn.disabled = true;
    runEvaluatorBtn.textContent = 'Evaluating Jobs...';
    appendLog('Starting AI job evaluation with Gemini...');

    try {
        const res = await fetch('/api/ops/run-evaluator', { method: 'POST' });
        const data = await parseResponse(res);
        if (data.logs) {
            data.logs.forEach((l) => appendLog(l));
        }
        if (data.success) {
            appendLog(
                `AI evaluation completed successfully. Evaluated ${data.evaluatedCount} jobs.`,
            );
        } else {
            appendLog(`Evaluator failed: ${data.error}`, true);
        }
        fetchStats();
    } catch (err) {
        appendLog(`Evaluator request failed: ${err.message}`, true);
    } finally {
        runScraperBtn.disabled = false;
        runScraperBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Run AI Evaluator`;
    }
}

async function runAnalyzer() {
    runAnalyzerBtn.disabled = true;
    runAnalyzerBtn.textContent = 'Analyzing Sources...';
    appendLog('Running source redundancy analysis...');

    try {
        const res = await fetch('/api/ops/run-analyzer', { method: 'POST' });
        const data = await parseResponse(res);
        if (data.success && data.report) {
            const r = data.report;
            appendLog(`=== Source Redundancy Analysis Report ===`);
            appendLog(`Total Unique Jobs: ${r.totalUniqueJobs}`);
            r.sources.forEach((s) => {
                const tag = s.noExclusiveJobs ? ' [no exclusive jobs]' : '';
                appendLog(
                    `• Source: ${s.name} | Total Jobs: ${s.totalJobs} (${s.coveragePercentage}%) | Exclusive: ${s.exclusiveJobs}${tag}`,
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
runEvaluatorBtn.addEventListener('click', runEvaluator);
runAnalyzerBtn.addEventListener('click', runAnalyzer);
refreshTableBtn.addEventListener('click', loadTableInspector);

// Initial load
fetchStats();
loadTableInspector();
