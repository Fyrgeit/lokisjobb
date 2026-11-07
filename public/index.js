let allJobs = [];
let currentView = localStorage.getItem('lokisjobb_view') || 'card';

const searchInput = document.getElementById('searchInput');
const categoryDropdownButton = document.getElementById('categoryDropdownButton');
const categoryDropdownMenu = document.getElementById('categoryDropdownMenu');
const categoryDropdownLabel = document.getElementById('categoryDropdownLabel');
const categoryCheckboxes = document.querySelectorAll(
    'input[name="categoryFilter"]',
);
const availabilityFilter = document.getElementById('availabilityFilter');
const sourceFilter = document.getElementById('sourceFilter');
const sortSelect = document.getElementById('sortSelect');
const outputEl = document.getElementById('output');
const refreshButton = document.getElementById('refreshButton');
const jobCountLabel = document.getElementById('jobCountLabel');
const cardViewBtn = document.getElementById('cardViewBtn');
const listViewBtn = document.getElementById('listViewBtn');

const statTotal = document.getElementById('statTotal');
const statActive = document.getElementById('statActive');
const statAiCategory = document.getElementById('statAiCategory');

const categoryOrder = [
    'Persontåg',
    'Godståg',
    'Växlare',
    'Intressant',
    'Ointressant',
    'Okänd',
];

async function fetchJobs() {
    try {
        const response = await fetch('/api/jobs');
        const text = await response.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            throw new Error(
                `Servern returnerade ett ogiltigt svar (${response.status} ${response.statusText}): ${text.slice(0, 150)}`,
            );
        }
        if (!response.ok) {
            throw new Error(
                json.error ||
                    json.message ||
                    `HTTP-fel ${response.status} ${response.statusText}`,
            );
        }
        if (json.jobs) {
            allJobs = json.jobs;
            populateSources();
            updateDashboard();
        } else if (json.error) {
            outputEl.innerHTML = `<div class="col-span-full p-4 bg-red-50 text-red-700 rounded-lg">Fel: ${json.error}</div>`;
        }
    } catch (err) {
        outputEl.innerHTML = `<div class="col-span-full p-4 bg-red-50 text-red-700 rounded-lg">Det gick inte att läsa in jobb: ${err.message}</div>`;
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
    sourceFilter.innerHTML = '<option value="">Alla källor</option>';
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
    const categorizedJobs = allJobs.filter((j) => j.aiCategory);

    statTotal.textContent = total;
    statActive.textContent = active;
    statAiCategory.textContent = categorizedJobs.length;

    // 2. Filter & Sort
    const query = searchInput.value.toLowerCase().trim();
    const selectedCategories = Array.from(categoryCheckboxes)
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value);
    const availabilityVal = availabilityFilter.value;
    const sourceVal = sourceFilter.value;
    const sortVal = sortSelect.value;

    let filtered = allJobs.filter((job) => {
        const matchesQuery =
            !query ||
            (job.title && job.title.toLowerCase().includes(query)) ||
            (job.company && job.company.toLowerCase().includes(query)) ||
            (job.location && job.location.toLowerCase().includes(query));

        const matchesCategory =
            selectedCategories.length === 0 ||
            selectedCategories.includes(job.aiCategory ?? 'Okänd');
        const matchesAvailability =
            !availabilityVal || job.availability === availabilityVal;
        const matchesSource =
            !sourceVal ||
            (job.sources && job.sources.some((s) => s.name === sourceVal));

        return (
            matchesQuery &&
            matchesCategory &&
            matchesAvailability &&
            matchesSource
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
        if (sortVal === 'category-asc') {
            const categoryComparison =
                categoryOrder.indexOf(a.aiCategory ?? 'Okänd') -
                categoryOrder.indexOf(b.aiCategory ?? 'Okänd');
            return (
                categoryComparison ||
                (a.title || '').localeCompare(b.title || '')
            );
        }
        if (sortVal === 'title-asc') {
            return (a.title || '').localeCompare(b.title || '');
        }
        if (sortVal === 'company-asc') {
            return (a.company || '').localeCompare(b.company || '');
        }
        if (sortVal === 'deadline-asc') {
            const dateA = a.applicationDeadline
                ? new Date(a.applicationDeadline).getTime()
                : Infinity;
            const dateB = b.applicationDeadline
                ? new Date(b.applicationDeadline).getTime()
                : Infinity;
            return dateA - dateB;
        }
        if (sortVal === 'deadline-desc') {
            const dateA = a.applicationDeadline
                ? new Date(a.applicationDeadline).getTime()
                : -Infinity;
            const dateB = b.applicationDeadline
                ? new Date(b.applicationDeadline).getTime()
                : -Infinity;
            return dateB - dateA;
        }
        return 0;
    });

    jobCountLabel.textContent = `Visar ${filtered.length} av ${total} jobb`;

    // Update container classes and buttons according to currentView
    if (currentView === 'list') {
        outputEl.className = 'flex flex-col gap-2';
        listViewBtn.className =
            'p-1.5 rounded text-slate-600 hover:text-slate-900 bg-white shadow-sm transition';
        cardViewBtn.className =
            'p-1.5 rounded text-slate-400 hover:text-slate-900 transition';
    } else {
        outputEl.className =
            'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6';
        cardViewBtn.className =
            'p-1.5 rounded text-slate-600 hover:text-slate-900 bg-white shadow-sm transition';
        listViewBtn.className =
            'p-1.5 rounded text-slate-400 hover:text-slate-900 transition';
    }

    // 3. Render
    outputEl.innerHTML = '';
    if (filtered.length === 0) {
        outputEl.innerHTML = `
            <div class="col-span-full text-center py-12 bg-white rounded-xl border border-slate-200">
                <p class="text-slate-500 font-medium">Inga jobb matchar dina sökkriterier.</p>
            </div>
        `;
        return;
    }

    filtered.forEach((job) => {
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

        const categoryColors = {
            Persontåg: 'bg-purple-50 text-purple-700 border border-purple-200',
            Godståg: 'bg-purple-50 text-purple-700 border border-purple-200',
            Växlare: 'bg-purple-50 text-purple-700 border border-purple-200',
            Intressant: 'bg-amber-50 text-amber-700 border border-amber-200',
            Ointressant: 'bg-rose-50 text-rose-700 border border-rose-200',
            Okänd: 'bg-slate-100 text-slate-600 border border-slate-200',
        };
        const category = job.aiCategory ?? 'Okänd';
        const categoryBadge = `<span class="px-2.5 py-1 ${categoryColors[category] || 'bg-slate-100 text-slate-700'} rounded-lg text-xs font-semibold">${category}</span>`;
        const availabilityLabels = {
            active: 'Aktiv',
            closed: 'Stängd',
            unknown: 'Okänd',
        };
        const availability = availabilityLabels[job.availability] || 'Okänd';

        if (currentView === 'list') {
            const row = document.createElement('div');
            row.className =
                'bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:shadow-md transition';

            row.innerHTML = `
                <div class="flex items-center gap-3 flex-wrap min-w-0 flex-1">
                    <span class="text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${availabilityColors[job.availability] || 'bg-slate-100 text-slate-600'}">
                        ${availability}
                    </span>
                    ${categoryBadge}
                    <div class="min-w-0 flex-1">
                        <h3 class="font-bold text-slate-900 truncate">
                            <a href="${job.url}" target="_blank" class="hover:text-indigo-600 transition">${job.title}</a>
                        </h3>
                        <p class="text-xs text-slate-500 truncate">
                            ${job.company || 'Okänt företag'} ${job.location ? `• ${job.location}` : ''}
                        </p>
                    </div>
                </div>

                <div class="flex items-center gap-4 text-xs text-slate-500 self-end sm:self-center">
                    <div class="flex flex-wrap gap-1">
                        ${sourcesHtml}
                    </div>
                    <a href="${job.url}" target="_blank" class="font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 whitespace-nowrap">
                        Visa
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                    </a>
                </div>
            `;
            outputEl.appendChild(row);
        } else {
            const card = document.createElement('div');
            card.className =
                'bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between hover:shadow-md transition';

            card.innerHTML = `
                <div>
                    <div class="flex items-start justify-between gap-2 mb-2">
                        <div class="flex items-center gap-2">
                            <span class="text-xs px-2.5 py-1 rounded-lg font-medium ${availabilityColors[job.availability] || 'bg-slate-100 text-slate-600'}">
                                ${availability}
                            </span>
                            ${categoryBadge}
                        </div>
                    </div>

                    <h3 class="font-bold text-lg text-slate-900 mb-1 leading-snug">
                        <a href="${job.url}" target="_blank" class="hover:text-indigo-600 transition">${job.title}</a>
                    </h3>

                    <p class="text-sm font-medium text-slate-600 mb-3">
                        ${job.company || 'Okänt företag'} ${job.location ? `• <span class="text-slate-500">${job.location}</span>` : ''}
                    </p>

                    <p class="text-xs text-slate-500 line-clamp-3 mb-4">
                        ${job.description || 'Ingen beskrivning tillgänglig.'}
                    </p>
                </div>

                <div class="pt-4 border-t border-slate-100 flex items-center justify-between gap-2 mt-auto">
                    <div class="flex flex-wrap gap-1">
                        ${sourcesHtml}
                    </div>
                    <a href="${job.url}" target="_blank" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                        Visa jobb
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                    </a>
                </div>
            `;
            outputEl.appendChild(card);
        }
    });
}

// Event Listeners
searchInput.addEventListener('input', updateDashboard);
document.addEventListener('click', (e) => {
    const categoryContainer = document.getElementById(
        'categoryDropdownContainer',
    );
    if (categoryContainer && !categoryContainer.contains(e.target)) {
        categoryDropdownMenu.classList.add('hidden');
    }
});
categoryDropdownButton.addEventListener('click', (e) => {
    e.stopPropagation();
    categoryDropdownMenu.classList.toggle('hidden');
});
categoryCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
        const checked = Array.from(categoryCheckboxes).filter(
            (item) => item.checked,
        );
        if (checked.length === 0) {
            categoryDropdownLabel.textContent = 'Alla AI-kategorier';
        } else if (checked.length === 1) {
            categoryDropdownLabel.textContent = checked[0].value;
        } else {
            categoryDropdownLabel.textContent = `${checked.length} kategorier valda`;
        }
        updateDashboard();
    });
});
availabilityFilter.addEventListener('change', updateDashboard);
sourceFilter.addEventListener('change', updateDashboard);
sortSelect.addEventListener('change', updateDashboard);
refreshButton.addEventListener('click', fetchJobs);
cardViewBtn.addEventListener('click', () => {
    currentView = 'card';
    localStorage.setItem('lokisjobb_view', 'card');
    updateDashboard();
});
listViewBtn.addEventListener('click', () => {
    currentView = 'list';
    localStorage.setItem('lokisjobb_view', 'list');
    updateDashboard();
});

// Initial Load
fetchJobs();
