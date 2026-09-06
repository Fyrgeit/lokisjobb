import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createDatabase } from "./database.js";
import { JobsRepository } from "./jobs.js";
import type { ScrapedJob } from "../types/job.js";

const databases: ReturnType<typeof createDatabase>[] = [];

function createRepository(): JobsRepository {
  const database = createDatabase(":memory:");
  databases.push(database);
  return new JobsRepository(database);
}

const scrapedJob: ScrapedJob = {
  title: "Lokförare",
  company: "Nordic Rail AB",
  location: "Stockholm",
  url: "https://example.com/jobs/driver",
  description: "Kör tåg i regional trafik."
};

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe("JobsRepository.upsert", () => {
  it("inserts a new job with initial state", () => {
    const repository = createRepository();
    const result = repository.upsert(scrapedJob, "2026-01-01T10:00:00.000Z");
    const job = repository.findByUrl(scrapedJob.url);

    assert.equal(result, "inserted");
    assert.equal(repository.list().length, 1);
    assert.equal(job?.discoveredAt, "2026-01-01T10:00:00.000Z");
    assert.equal(job?.lastSeenAt, "2026-01-01T10:00:00.000Z");
    assert.equal(job?.status, "new");
    assert.equal(job?.aiScore, null);
  });

  it("updates only last_seen_at for an existing URL", () => {
    const repository = createRepository();
    repository.upsert(scrapedJob, "2026-01-01T10:00:00.000Z");
    const firstJob = repository.findByUrl(scrapedJob.url);
    assert.ok(firstJob);
    repository.updateStatus(firstJob.id, "interested");
    repository.updateAiScore(firstJob.id, 0.85);

    const result = repository.upsert(
      { ...scrapedJob, title: "Updated title from source" },
      "2026-01-02T10:00:00.000Z"
    );
    const job = repository.findByUrl(scrapedJob.url);

    assert.equal(result, "updated");
    assert.equal(repository.list().length, 1);
    assert.equal(job?.discoveredAt, "2026-01-01T10:00:00.000Z");
    assert.equal(job?.lastSeenAt, "2026-01-02T10:00:00.000Z");
    assert.equal(job?.title, "Lokförare");
    assert.equal(job?.status, "interested");
    assert.equal(job?.aiScore, 0.85);
  });
});
