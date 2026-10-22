import express from 'express';
import path from 'node:path';
import { getJobs } from './list-jobs.js';

const app = express();
const PORT = 3000;

// Serve everything in /public
app.use(express.static(path.join(process.cwd(), 'public')));

// Example API endpoint
app.get('/api/jobs', (_req, res) => {
    res.json(getJobs());
});

app.listen(PORT, () => {
    console.log(`Lokisjobb running at http://localhost:${PORT}`);
});
