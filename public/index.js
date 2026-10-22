const getJobsButton = document.getElementById('getJobsButton');
const outputEl = document.getElementById('output');
getJobsButton.addEventListener('click', async () => {
    const response = await fetch('/api/jobs');
    const json = await response.json();

    if (json.error) {
        outputEl.innerHTML = json.error;
    }

    if (json.jobs) {
        outputEl.innerHTML = '';

        json.jobs.forEach((job) => {
            const divEl = document.createElement('div');

            divEl.innerHTML = JSON.stringify(job);

            outputEl.append(divEl);
        });
    }
});
