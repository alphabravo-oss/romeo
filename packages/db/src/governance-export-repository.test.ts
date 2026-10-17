import { describe, expect, it } from "vitest";
import type {
  GovernanceExportArtifactRecord,
  GovernanceExportJobRecord,
} from "@romeo/core";

import { PgGovernanceExportRepository } from "./governance-export-repository";

const now = "2026-08-23T12:00:00.000Z";

describe("PgGovernanceExportRepository", () => {
  it("persists, reads, and lists normalized export jobs", async () => {
    const job = jobRecord();
    const stored = jobRow();
    await expect(
      repository([[stored]]).createGovernanceExportJob(job),
    ).resolves.toMatchObject({ id: job.id, workspaceId: "workspace_default" });
    await expect(
      repository([[]]).createGovernanceExportJob(job),
    ).rejects.toThrow("governance_export_job_conflict");
    await expect(
      repository([[stored]]).getGovernanceExportJob(job.orgId, job.id),
    ).resolves.toMatchObject({ id: job.id });
    await expect(
      repository([[]]).getGovernanceExportJob(job.orgId, "missing"),
    ).resolves.toBeUndefined();
    await expect(
      repository([
        [stored, jobRow({ id: "export_2", workspaceId: null })],
      ]).listGovernanceExportJobs(job.orgId, 20),
    ).resolves.toHaveLength(2);
  });

  it("claims queued jobs with fencing and handles idle and raced claims", async () => {
    const input = {
      orgId: "org_default",
      jobId: "export_1",
      workerId: "worker_a",
      leaseSeconds: 300,
      now,
    };
    await expect(
      repository([[]]).claimGovernanceExportJob(input),
    ).resolves.toBeUndefined();
    await expect(
      repository([[jobRow()], []]).claimGovernanceExportJob(input),
    ).resolves.toBeUndefined();
    await expect(
      repository([
        [jobRow()],
        [jobRow({ state: "running", version: 2, leaseAttempt: 2 })],
      ]).claimGovernanceExportJob(input),
    ).resolves.toMatchObject({ state: "running", version: 2 });
    const { jobId: _jobId, ...unscopedInput } = input;
    await expect(
      repository([[jobRow()], [jobRow()]]).claimGovernanceExportJob(
        unscopedInput,
      ),
    ).resolves.toBeDefined();
  });

  it("updates jobs through both fenced and administrative paths", async () => {
    const job = jobRecord({
      state: "artifact_ready",
      version: 2,
      completedAt: now,
      deletedAt: now,
      errorCode: "export_warning",
    });
    const fenced = { job, workerId: "worker_a", leaseAttempt: 1 };
    await expect(
      repository([
        [jobRow({ state: "artifact_ready", version: 2 })],
      ]).updateGovernanceExportJobWithLease(fenced),
    ).resolves.toMatchObject({ state: "artifact_ready" });
    await expect(
      repository([[]]).updateGovernanceExportJobWithLease(fenced),
    ).resolves.toBeUndefined();
    await expect(
      repository([[jobRow({ version: 2 })]]).updateGovernanceExportJob(job),
    ).resolves.toMatchObject({ version: 2 });
    await expect(
      repository([[]]).updateGovernanceExportJob(job),
    ).resolves.toBeUndefined();
  });

  it("persists, reads, and tombstones export artifacts", async () => {
    const artifact = artifactRecord();
    const stored = artifactRow();
    await expect(
      repository([[stored]]).createGovernanceExportArtifact(artifact),
    ).resolves.toMatchObject({ id: artifact.id });
    await expect(
      repository([[]]).createGovernanceExportArtifact(artifact),
    ).rejects.toThrow("governance_export_artifact_conflict");
    await expect(
      repository([[stored]]).getGovernanceExportArtifact(
        artifact.orgId,
        artifact.jobId,
      ),
    ).resolves.toMatchObject({ sha256: artifact.sha256 });
    await expect(
      repository([[]]).getGovernanceExportArtifact(artifact.orgId, "missing"),
    ).resolves.toBeUndefined();
    await expect(
      repository([
        [artifactRow({ deletedAt: new Date(now) })],
      ]).updateGovernanceExportArtifact({ ...artifact, deletedAt: now }),
    ).resolves.toMatchObject({ deletedAt: now });
    await expect(
      repository([[]]).updateGovernanceExportArtifact(artifact),
    ).resolves.toBeUndefined();
  });
});

function jobRecord(
  overrides: Partial<GovernanceExportJobRecord> = {},
): GovernanceExportJobRecord {
  return {
    id: "export_1",
    orgId: "org_default",
    workspaceId: "workspace_default",
    createdBy: "user_dev_admin",
    request: {
      scope: "workspace" as const,
      workspaceId: "workspace_default",
      includeContent: false,
      includeObjectBytes: false,
      maxObjectBytes: 0,
    },
    snapshotAt: now,
    state: "queued" as const,
    percent: 0,
    checkpoint: {
      datasetIndex: 0,
      partCount: 0,
      processedRows: 0,
      sizeBytes: 0,
    },
    counts: {
      workspaces: 0,
      agents: 0,
      promptTemplates: 0,
      chats: 0,
      messages: 0,
      messageParts: 0,
      chatComments: 0,
      knowledgeBases: 0,
      knowledgeSources: 0,
      knowledgeChunks: 0,
      fileObjects: 0,
      fileObjectBytesIncluded: 0,
      knowledgeSourceBytesIncluded: 0,
      workflows: 0,
      workflowRuns: 0,
      usageEvents: 0,
      backgroundJobs: 0,
    },
    limits: { maxObjectBytes: 0, maxTotalObjectBytes: 0 },
    warnings: [],
    exclusions: [],
    leaseOwner: "worker_a",
    leaseExpiresAt: "2026-08-23T12:05:00.000Z",
    leaseAttempt: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    ...jobRecord(),
    snapshotAt: new Date(now),
    createdAt: new Date(now),
    updatedAt: new Date(now),
    leaseExpiresAt: new Date("2026-08-23T12:05:00.000Z"),
    completedAt: null,
    deletedAt: null,
    errorCode: null,
    ...overrides,
  };
}

function artifactRecord(): GovernanceExportArtifactRecord {
  return {
    id: "artifact_1",
    jobId: "export_1",
    orgId: "org_default",
    objectKey: "governance/export_1.ndjson",
    contentType: "application/x-ndjson" as const,
    fileName: "export.ndjson",
    sizeBytes: 42,
    sha256: "a".repeat(64),
    partCount: 1,
    createdAt: now,
    expiresAt: "2026-08-24T12:00:00.000Z",
  };
}

function artifactRow(overrides: Record<string, unknown> = {}) {
  return {
    ...artifactRecord(),
    createdAt: new Date(now),
    expiresAt: new Date("2026-08-24T12:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function repository(results: unknown[][]) {
  return new PgGovernanceExportRepository(chainDatabase(results) as never);
}

function chainDatabase(results: unknown[][]) {
  const pending = [...results];
  const database: Record<string, unknown> = {};
  const query = () => {
    const result = pending.shift() ?? [];
    const chain = new Proxy(
      {},
      {
        get: (_target, property) =>
          property === "then"
            ? (resolve: (value: unknown) => unknown) => resolve(result)
            : () => chain,
      },
    );
    return chain;
  };
  database.insert = query;
  database.select = query;
  database.update = query;
  database.transaction = (callback: (transaction: unknown) => unknown) =>
    callback(database);
  return database;
}
