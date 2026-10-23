let allJobs = [];

const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const availabilityFilter = document.getElementById('availabilityFilter');
const sourceFilter = document.getElementById('sourceFilter');
const aiScoreFilter = document.getElementById('aiScoreFilter');
const sortSelect = document.getElementById('sortSelect');
const outputEl = document.getElementById('output');
const refreshButton = document.getElementById('refreshButton');
const jobCountLabel = document.getElementById('jobCountLabel');

const statTotal = document.getElementById('statTotal');
const statActive = document.getElementById('statActive');
const statInterested = document.getElementById('statInterested');
const statApplied = document.getElementById('statApplied');
const statAiScore = document.getElementById('statAiScore');

async function fetchJobs() {
    try {
        const response = await fetch('/api/jobs');
        const text = await response.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            throw new Error(
                `Server returned non-JSON response (${response.status} ${response.statusText}): ${text.slice(0, 150)}`,
            );
        }
        if (!response.ok) {
            throw new Error(
                json.error ||
                    json.message ||
                    `HTTP error ${response.status} ${response.statusText}`,
            );
        }
        if (json.jobs) {
            allJobs = json.jobs;
            populateSources();
            updateDashboard();
        } else if (json.error) {
            outputEl.innerHTML = `<div class="col-span-full p-4 bg-red-50 text-red-700 rounded-lg">${json.error}</div>`;
        }
    } catch (err) {
        outputEl.innerHTML = `<div class="col-span-full p-4 bg-red-50 text-red-700 rounded-lg">Failed to load jobs: ${err.message}</div>`;
    }
}

function populateSources() {
    const sourcesSet = new Set();
    allJobs.forEach((job) => {
        if (job.sources) {
            job.sources.forEach((s) => sourcesSet.add(s.name));
        }
    });

    const currentSource = sourceFilter.value;
    sourceFilter.innerHTML = '<option value="">All Providers</option>';
    sourcesSet.forEach((source) => {
        const opt = document.createElement('option');
        opt.value = source;
        opt.textContent = source;
        sourceFilter.appendChild(opt);
    });
    sourceFilter.value = currentSource;
}

function updateDashboard() {
    // 1. Calculate Stats
    const total = allJobs.length;
    const active = allJobs.filter((j) => j.availability === 'active').length;
    const interested = allJobs.filter((j) => j.status === 'interested').length;
    const applied = allJobs.filter((j) => j.status === 'applied').length;

    const scoredJobs = allJobs.filter((j) => typeof j.aiScore === 'number');
    const avgScore =
        scoredJobs.length > 0
            ? (
                  scoredJobs.reduce((sum, j) => sum + j.aiScore, 0) /
                  scoredJobs.length
              ).toFixed(1)
            : '-';

    statTotal.textContent = total;
    statActive.textContent = active;
    statInterested.textContent = interested;
    statApplied.textContent = applied;
    statAiScore.textContent = avgScore === '-' ? '-' : `${avgScore} / 10`;

    // 2. Filter & Sort
    const query = searchInput.value.toLowerCase().trim();
    const statusVal = statusFilter.value;
    const availabilityVal = availabilityFilter.value;
    const sourceVal = sourceFilter.value;
    const aiScoreVal = aiScoreFilter.value;
    const sortVal = sortSelect.value;

    let filtered = allJobs.filter((job) => {
        const matchesQuery =
            !query ||
            (job.title && job.title.toLowerCase().includes(query)) ||
            (job.company && job.company.toLowerCase().includes(query)) ||
            (job.location && job.location.toLowerCase().includes(query));

        const matchesStatus = !statusVal || job.status === statusVal;
        const matchesAvailability =
            !availabilityVal || job.availability === availabilityVal;
        const matchesSource =
            !sourceVal ||
            (job.sources && job.sources.some((s) => s.name === sourceVal));

        let matchesAiScore = true;
        if (aiScoreVal === 'hide-zero') {
            matchesAiScore = job.aiScore !== 0;
        }

        return (
            matchesQuery &&
            matchesStatus &&
            matchesAvailability &&
            matchesSource &&
            matchesAiScore
        );
    });

    // Sorting
    filtered.sort((a, b) => {
        if (sortVal === 'discovered-desc') {
            return (
                new Date(b.discoveredAt || 0) - new Date(a.discoveredAt || 0)
            );
        }
        if (sortVal === 'discovered-asc') {
            return (
                new Date(a.discoveredAt || 0) - new Date(b.discoveredAt || 0)
            );
        }
        if (sortVal === 'score-desc') {
            return (b.aiScore ?? -1) - (a.aiScore ?? -1);
        }
        if (sortVal === 'score-asc') {
            return (a.aiScore ?? 999) - (b.aiScore ?? 999);
        }
        if (sortVal === 'title-asc') {
            return (a.title || '').localeCompare(b.title || '');
        }
        if (sortVal === 'company-asc') {
            return (a.company || '').localeCompare(b.company || '');
        }
        return 0;
    });

    jobCountLabel.textContent = `Showing ${filtered.length} of ${total} jobs`;

    // 3. Render
    outputEl.innerHTML = '';
    if (filtered.length === 0) {
        outputEl.innerHTML = `
            <div class="col-span-full text-center py-12 bg-white rounded-xl border border-slate-200">
                <p class="text-slate-500 font-medium">No jobs found matching your criteria.</p>
            </div>
        `;
        return;
    }

    filtered.forEach((job) => {
        const card = document.createElement('div');
        card.className =
            'bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between hover:shadow-md transition';

        const statusColors = {
            new: 'bg-slate-100 text-slate-700',
            interested: 'bg-amber-50 text-amber-700 border border-amber-200',
            applied: 'bg-blue-50 text-blue-700 border border-blue-200',
            rejected: 'bg-rose-50 text-rose-700 border border-rose-200',
        };

        const availabilityColors = {
            active: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
            closed: 'bg-slate-100 text-slate-500',
            unknown: 'bg-slate-100 text-slate-600',
        };

        const sourcesHtml =
            job.sources && job.sources.length > 0
                ? job.sources
                      .map(
                          (s) =>
                              `<span class="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">${s.name}</span>`,
                      )
                      .join(' ')
                : '';

        const scoreBadge =
            job.aiScore !== null && job.aiScore !== undefined
                ? `<span class="px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-semibold">AI Score: ${job.aiScore}</span>`
                : '';

        card.innerHTML = `
            <div>
                <div class="flex items-start justify-between gap-2 mb-2">
                    <span class="text-xs px-2.5 py-1 rounded-lg font-medium uppercase tracking-wider ${statusColors[job.status] || 'bg-slate-100 text-slate-700'}">
                        ${job.status}
                    </span>
                    <div class="flex items-center gap-2">
                        <span class="text-xs px-2.5 py-1 rounded-lg font-medium ${availabilityColors[job.availability] || 'bg-slate-100 text-slate-600'}">
                            ${job.availability}
                        </span>
                        ${scoreBadge}
                    </div>
                </div>

                <h3 class="font-bold text-lg text-slate-900 mb-1 leading-snug">
                    <a href="${job.url}" target="_blank" class="hover:text-indigo-600 transition">${job.title}</a>
                </h3>

                <p class="text-sm font-medium text-slate-600 mb-3">
                    ${job.company || 'Unknown Company'} ${job.location ? `• <span class="text-slate-500">${job.location}</span>` : ''}
                </p>

                <p class="text-xs text-slate-500 line-clamp-3 mb-4">
                    ${job.description || 'No description available.'}
                </p>
            </div>

            <div class="pt-4 border-t border-slate-100 flex items-center justify-between gap-2 mt-auto">
                <div class="flex flex-wrap gap-1">
                    ${sourcesHtml}
                </div>
                <a href="${job.url}" target="_blank" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                    View Job 
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                </a>
            </div>
        `;

        outputEl.appendChild(card);
    });
}

// Event Listeners
searchInput.addEventListener('input', updateDashboard);
statusFilter.addEventListener('change', updateDashboard);
availabilityFilter.addEventListener('change', updateDashboard);
sourceFilter.addEventListener('change', updateDashboard);
aiScoreFilter.addEventListener('change', updateDashboard);
sortSelect.addEventListener('change', updateDashboard);
refreshButton.addEventListener('click', fetchJobs);

// Initial Load
fetchJobs();
