const statTotalJobs = document.getElementById('statTotalJobs');
const statTotalListingLinks = document.getElementById('statTotalListingLinks');
const statDbPath = document.getElementById('statDbPath');

const runScraperBtn = document.getElementById('runScraperBtn');
const runScraperOnlyBtn = document.getElementById('runScraperOnlyBtn');
const runEvaluatorBtn = document.getElementById('runEvaluatorBtn');
const runAnalyzerBtn = document.getElementById('runAnalyzerBtn');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const terminalOutput = document.getElementById('terminalOutput');
const runHistoryList = document.getElementById('runHistoryList');

const tableSelect = document.getElementById('tableSelect');
const refreshTableBtn = document.getElementById('refreshTableBtn');
const clearDatabaseBtn = document.getElementById('clearDatabaseBtn');
const inspectorTable = document.getElementById('inspectorTable');
const inspectorBody = document.getElementById('inspectorBody');

function appendLog(text, isError = false) {
    const time = new Date().toLocaleTimeString();
    const prefix = `[${time}] `;
    terminalOutput.textContent += `${prefix}${text}\n`;
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

clearLogsBtn.addEventListener('click', () => {
    terminalOutput.textContent = 'Konsolen har rensats.\n';
});

async function parseResponse(res) {
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(
            `Servern returnerade ett ogiltigt svar (${res.status} ${res.statusText}): ${text.slice(0, 150)}`,
        );
    }
    if (!res.ok) {
        throw new Error(
            data.error ||
                data.message ||
                `HTTP-fel ${res.status} ${res.statusText}`,
        );
    }
    return data;
}

async function consumeOperationStream(res) {
    if (!res.ok) {
        await parseResponse(res);
        throw new Error(`HTTP-fel ${res.status} ${res.statusText}`);
    }
    if (!res.body) {
        throw new Error('Serverns svar stöder inte strömning.');
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
            throw new Error(`Ogiltig händelse i körningsströmmen: ${line}`);
        }

        if (event.type === 'log') {
            appendLog(event.message);
        } else if (event.type === 'result') {
            result = event;
        } else if (event.type === 'error') {
            throw new Error(event.message);
        } else {
            throw new Error(`Okänd händelsetyp i körningsströmmen: ${event.type}`);
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
        throw new Error('Körningsströmmen avslutades utan resultat.');
    }
    return result;
}

async function fetchStats() {
    try {
        const res = await fetch('/api/database/stats');
        const data = await parseResponse(res);
        if (data.totalJobs !== undefined) {
            statTotalJobs.textContent = data.totalJobs;
            statTotalListingLinks.textContent = data.totalListingLinks;
            statDbPath.textContent = data.databasePath;
        }
    } catch (err) {
        appendLog(`Det gick inte att hämta databasstatistik: ${err.message}`, true);
    }
}

function formatRunSummary(entry) {
    const summary = entry.summary || {};
    if (entry.operation === 'fetch') {
        const details = [
            `${summary.found ?? 0} hittade`,
            `${summary.added ?? 0} nya`,
            `${summary.updated ?? 0} uppdaterade`,
        ];
        if (summary.skipped) details.push(`${summary.skipped} överhoppade`);
        if (summary.failed) details.push(`${summary.failed} källfel`);
        return `${summary.source || 'Alla källor'} — ${details.join(', ')}`;
    }

    const details = [
        `${summary.evaluated ?? 0} klassificerade`,
        `${summary.failed ?? 0} misslyckades`,
    ];
    if (summary.remainingUnknown !== undefined) {
        details.push(`${summary.remainingUnknown} okategoriserade kvar`);
    }
    if (summary.reason) details.push(String(summary.reason));
    return details.join(', ');
}

function renderRunHistory(entries) {
    const shouldScrollToBottom =
        runHistoryList.scrollHeight -
            runHistoryList.scrollTop -
            runHistoryList.clientHeight <
        24;
    runHistoryList.replaceChildren();
    if (entries.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'py-4 text-sm text-slate-500';
        empty.textContent = 'Inga hämtningar eller AI-klassificeringar ännu.';
        runHistoryList.append(empty);
        return;
    }

    const labels = {
        fetch: 'Hämtning',
        ai_classification: 'AI-klassificering',
    };
    const statusLabels = {
        running: 'Pågår',
        success: 'Klar',
        partial: 'Delvis',
        failed: 'Misslyckades',
        skipped: 'Överhoppad',
    };

    for (const entry of [...entries].reverse()) {
        const item = document.createElement('li');
        item.className =
            'flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 py-4';

        const content = document.createElement('div');
        content.className = 'min-w-0';
        const title = document.createElement('p');
        title.className = 'text-sm font-semibold text-slate-100';
        title.textContent = `${labels[entry.operation] || entry.operation} · ${formatRunSummary(entry)}`;
        content.append(title);

        if (entry.errorMessage) {
            const error = document.createElement('p');
            error.className = 'text-xs text-rose-400 mt-1 break-words';
            error.textContent = entry.errorMessage;
            content.append(error);
        }

        const metadata = document.createElement('div');
        metadata.className =
            'flex items-center gap-2 text-xs text-slate-400 shrink-0';
        const time = document.createElement('time');
        time.dateTime = entry.startedAt;
        time.textContent = new Date(entry.startedAt).toLocaleString('sv-SE', {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
        metadata.append(time);
        if (entry.durationMs !== null) {
            const duration = document.createElement('span');
            duration.textContent = `${(entry.durationMs / 1000).toFixed(1)} s`;
            metadata.append(duration);
        }
        const status = document.createElement('span');
        status.className =
            entry.status === 'failed'
                ? 'text-rose-400'
                : entry.status === 'partial'
                  ? 'text-amber-400'
                  : entry.status === 'running'
                    ? 'text-blue-400'
                    : 'text-emerald-400';
        status.textContent = statusLabels[entry.status] || entry.status;
        metadata.append(status);

        item.append(content, metadata);
        runHistoryList.append(item);
    }

    if (shouldScrollToBottom) {
        runHistoryList.scrollTop = runHistoryList.scrollHeight;
    }
}

async function fetchRunHistory() {
    try {
        const res = await fetch('/api/ops/history');
        const data = await parseResponse(res);
        renderRunHistory(data.entries);
    } catch (err) {
        appendLog(`Det gick inte att läsa körningshistoriken: ${err.message}`, true);
    }
}

async function runScraper() {
    runScraperBtn.disabled = true;
    runScraperBtn.textContent = 'Hämtar jobb och AI-klassificerar...';
    appendLog('Startar hämtning av jobb och AI-klassificering...');

    try {
        const res = await fetch('/api/ops/run-scraper', { method: 'POST' });
        const data = await consumeOperationStream(res);
        if (data.success) {
            appendLog(
                `Körningen är klar. Hittade: ${data.totals.found}, tillagda: ${data.totals.added}, uppdaterade: ${data.totals.updated}, AI-klassificerade: ${data.evaluatedCount}`,
            );
        } else {
            appendLog(`Körningen misslyckades: ${data.error}`, true);
        }
        fetchStats();
    } catch (err) {
        appendLog(`Begäran om körning misslyckades: ${err.message}`, true);
    } finally {
        await fetchRunHistory();
        runScraperBtn.disabled = false;
        runScraperBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Hämta jobb och AI-klassificera`;
    }
}

async function runScraperOnly() {
    runScraperOnlyBtn.disabled = true;
    runScraperOnlyBtn.querySelector('span').textContent = 'Hämtar jobb...';
    appendLog('Startar hämtning av jobbannonser...');

    try {
        const res = await fetch('/api/ops/run-scraper-only', { method: 'POST' });
        const data = await consumeOperationStream(res);
        if (data.success) {
            appendLog(
                `Hämtningen är klar. Hittade: ${data.totals.found}, tillagda: ${data.totals.added}, uppdaterade: ${data.totals.updated}`,
            );
            fetchStats();
        } else {
            appendLog(`Hämtningen misslyckades: ${data.error}`, true);
        }
    } catch (err) {
        appendLog(`Begäran om hämtning misslyckades: ${err.message}`, true);
    } finally {
        await fetchRunHistory();
        runScraperOnlyBtn.disabled = false;
        runScraperOnlyBtn.querySelector('span').textContent = 'Hämta jobb';
    }
}

async function runEvaluator() {
    runEvaluatorBtn.disabled = true;
    runEvaluatorBtn.querySelector('span').textContent = 'AI-klassificerar jobb...';
    appendLog('Startar AI-klassificering av jobb utan kategori...');

    try {
        const res = await fetch('/api/ops/run-evaluator', { method: 'POST' });
        const data = await consumeOperationStream(res);
        if (data.success) {
            appendLog(
                `AI-klassificeringen är klar. Antal klassificerade: ${data.evaluatedCount}`,
            );
            fetchStats();
        } else {
            appendLog(`AI-klassificeringen misslyckades: ${data.error}`, true);
        }
    } catch (err) {
        appendLog(`Begäran om AI-klassificering misslyckades: ${err.message}`, true);
    } finally {
        await fetchRunHistory();
        runEvaluatorBtn.disabled = false;
        runEvaluatorBtn.querySelector('span').textContent = 'AI-klassificera jobb';
    }
}

async function runAnalyzer() {
    runAnalyzerBtn.disabled = true;
    runAnalyzerBtn.textContent = 'Analyserar leverantörer...';
    appendLog('Analyserar överlapp mellan jobbportaler...');

    try {
        const res = await fetch('/api/ops/run-analyzer', { method: 'POST' });
        const data = await parseResponse(res);
        if (data.success && data.report) {
            const r = data.report;
            appendLog(`=== Rapport: överlapp mellan jobbportaler ===`);
            appendLog(`Unika jobb totalt: ${r.totalUniqueJobs}`);
            r.providers.forEach((s) => {
                const tag = s.noExclusiveJobs ? ' [inga unika jobb]' : '';
                appendLog(
                    `• Leverantör: ${s.name} | Jobb totalt: ${s.totalJobs} (${s.coveragePercentage}%) | Unika jobb: ${s.exclusiveJobs}${tag}`,
                );
            });
            if (r.minimalCovers.length > 0) {
                appendLog(
                    `Minsta kombination som täcker allt: [ ${r.minimalCovers[0].providers.join(', ')} ] -> ${r.minimalCovers[0].coveragePercentage}% täckning`,
                );
            }
        } else {
            appendLog(`Analysen misslyckades: ${data.error}`, true);
        }
    } catch (err) {
        appendLog(`Begäran om analys misslyckades: ${err.message}`, true);
    } finally {
        runAnalyzerBtn.disabled = false;
        runAnalyzerBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2-2z"/></svg> Analysera källor`;
    }
}

async function loadTableInspector() {
    const tableName = tableSelect.value;
    appendLog(`Läser in tabellen "${tableName}"...`);

    try {
        const res = await fetch(`/api/database/tables/${tableName}`);
        const data = await parseResponse(res);

        if (data.error) {
            appendLog(`Det gick inte att läsa in tabellen: ${data.error}`, true);
            return;
        }

        const rows = data.rows || [];
        if (rows.length === 0) {
            inspectorTable.querySelector('thead').innerHTML =
                `<tr><th class="p-3">Inga poster hittades i ${tableName}</th></tr>`;
            inspectorBody.innerHTML = `<tr><td class="p-4 text-slate-500 text-center">Tabellen är tom.</td></tr>`;
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

        appendLog(`Läste in ${rows.length} rader från tabellen "${tableName}".`);
    } catch (err) {
        appendLog(`Det gick inte att läsa in tabellen: ${err.message}`, true);
    }
}

clearDatabaseBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
        'Är du säker på att du vill rensa databasen? Alla jobb och länkar raderas permanent. Körhistoriken bevaras.',
    );
    if (!confirmed) return;

    clearDatabaseBtn.disabled = true;
    try {
        const res = await fetch('/api/database', { method: 'DELETE' });
        const data = await parseResponse(res);
        appendLog(
            `Databasen har rensats: ${data.deletedJobs} jobb och ${data.deletedLinks} länkar raderades.`,
        );
        await Promise.all([fetchStats(), loadTableInspector()]);
    } catch (err) {
        appendLog(`Det gick inte att rensa databasen: ${err.message}`, true);
    } finally {
        clearDatabaseBtn.disabled = false;
    }
});

runScraperBtn.addEventListener('click', runScraper);
runScraperOnlyBtn.addEventListener('click', runScraperOnly);
runEvaluatorBtn.addEventListener('click', runEvaluator);
runAnalyzerBtn.addEventListener('click', runAnalyzer);
refreshTableBtn.addEventListener('click', loadTableInspector);
// Initial load
fetchStats();
fetchRunHistory();
window.setInterval(fetchRunHistory, 30_000);
loadTableInspector();
