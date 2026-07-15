import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { summarizeBackgroundJobs } from "./services/job-service";

describe("Romeo background job operations", () => {
  it("claims, renews, and reclaims background jobs through leases", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createBackgroundJob({
      id: "job_claimable",
      orgId: "org_default",
      type: "tool.operation.dispatch_request",
      status: "queued",
      payload: { connectorId: "connector_1" },
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    });

    const claimed = await repository.claimBackgroundJob({
      orgId: "org_default",
      type: "tool.operation.dispatch_request",
      workerId: "worker_a",
      leaseSeconds: 300,
      now: "2026-06-30T00:01:00.000Z",
    });
    expect(claimed).toMatchObject({
      id: "job_claimable",
      status: "running",
      payload: {
        workerLease: {
          attempt: 1,
          claimedAt: "2026-06-30T00:01:00.000Z",
          expiresAt: "2026-06-30T00:06:00.000Z", // deliberately-expired: expected expiry from claimedAt 00:01 + 300s leaseSeconds on this test's synthetic `now` clock; part of the fabricated-past timeline whose staleness (see line ~72) drives the reclaim assertion below
          leaseSeconds: 300,
          renewedAt: "2026-06-30T00:01:00.000Z",
          workerId: "worker_a",
        },
      },
    });

    await expect(
      repository.claimBackgroundJob({
        orgId: "org_default",
        type: "tool.operation.dispatch_request",
        workerId: "worker_b",
        leaseSeconds: 300,
        now: "2026-06-30T00:02:00.000Z",
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.renewBackgroundJobLease({
        orgId: "org_default",
        jobId: "job_claimable",
        workerId: "worker_b",
        leaseSeconds: 300,
        now: "2026-06-30T00:02:00.000Z",
      }),
    ).resolves.toBeUndefined();

    const renewed = await repository.renewBackgroundJobLease({
      orgId: "org_default",
      jobId: "job_claimable",
      workerId: "worker_a",
      leaseSeconds: 600,
      now: "2026-06-30T00:02:00.000Z",
    });
    expect(renewed).toMatchObject({
      payload: {
        workerLease: {
          attempt: 1,
          expiresAt: "2026-06-30T00:12:00.000Z", // deliberately-expired: renewed lease's expected expiry (renewedAt 00:02 + 600s leaseSeconds); must be stale relative to the reclaim's now: 00:13:00 for job_claimable to be reclaimed by worker_b as attempt 2
          leaseSeconds: 600,
          renewedAt: "2026-06-30T00:02:00.000Z",
          workerId: "worker_a",
        },
      },
      status: "running",
    });

    const reclaimed = await repository.claimBackgroundJob({
      orgId: "org_default",
      type: "tool.operation.dispatch_request",
      workerId: "worker_b",
      leaseSeconds: 300,
      now: "2026-06-30T00:13:00.000Z",
    });
    expect(reclaimed).toMatchObject({
      id: "job_claimable",
      payload: {
        workerLease: {
          attempt: 2,
          claimedAt: "2026-06-30T00:13:00.000Z",
          workerId: "worker_b",
        },
      },
      status: "running",
    });
  });

  it("summarizes queue lag and failed-job alerts without exposing payloads", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createBackgroundJob({
      id: "job_queued_old",
      orgId: "org_default",
      type: "tool.operation.dispatch_request",
      status: "queued",
      payload: { prompt: "RAW_QUEUE_SECRET_SENTINEL" },
      createdAt: "2026-06-30T00:40:00.000Z",
      updatedAt: "2026-06-30T00:40:00.000Z",
    });
    await repository.createBackgroundJob({
      id: "job_running_stale",
      orgId: "org_default",
      type: "webhook.retry_due",
      status: "running",
      payload: { webhookBody: "RAW_RUNNING_SECRET_SENTINEL" },
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:55:00.000Z",
    });
    await repository.createBackgroundJob({
      id: "job_failed_recent",
      orgId: "org_default",
      type: "webhook.retry_due",
      status: "failed",
      payload: {
        errorCode: "worker_failed",
        rawBody: "RAW_FAILED_SECRET_SENTINEL",
      },
      createdAt: "2026-06-30T00:58:00.000Z",
      updatedAt: "2026-06-30T00:59:00.000Z",
      completedAt: "2026-06-30T00:59:00.000Z",
    });
    await repository.createBackgroundJob({
      id: "job_dead_lettered",
      orgId: "org_default",
      type: "tool.operation.dispatch_request",
      status: "failed",
      payload: {
        deadLetter: {
          raw: "RAW_DEAD_LETTER_SECRET_SENTINEL",
          reasonCode: "max_attempts_exhausted",
        },
        errorCode: "worker_attempts_exhausted",
      },
      createdAt: "2026-06-30T00:57:00.000Z",
      updatedAt: "2026-06-30T00:59:30.000Z",
      completedAt: "2026-06-30T00:59:30.000Z",
    });

    const summary = summarizeBackgroundJobs(
      await repository.listBackgroundJobs("org_default"),
      {
        now: "2026-06-30T01:00:00.000Z",
        thresholds: {
          queuedWarningSeconds: 300,
          queuedCriticalSeconds: 900,
          runningWarningSeconds: 120,
          runningCriticalSeconds: 240,
          deadLetterWarningCount: 1,
          deadLetterCriticalCount: 2,
          failedWarningCount: 1,
          failedCriticalCount: 3,
        },
      },
    );

    expect(summary.status).toBe("critical");
    expect(summary.totals).toMatchObject({
      total: 4,
      queued: 1,
      running: 1,
      failed: 2,
      deadLettered: 1,
      recentFailed: 2,
    });
    expect(summary.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "job_queued_lag_tool_operation_dispatch_request",
          metric: "queued_lag_seconds",
          severity: "critical",
          value: 1200,
          jobId: "job_queued_old",
        }),
        expect.objectContaining({
          id: "job_running_stale_webhook_retry_due",
          metric: "running_stale_seconds",
          severity: "critical",
          value: 300,
          jobId: "job_running_stale",
        }),
        expect.objectContaining({
          id: "job_recent_failures_webhook_retry_due",
          metric: "recent_failed_jobs",
          severity: "warning",
          value: 1,
        }),
        expect.objectContaining({
          id: "job_dead_letters_tool_operation_dispatch_request",
          metric: "dead_letter_jobs",
          severity: "warning",
          value: 1,
        }),
      ]),
    );
    expect(JSON.stringify(summary)).not.toContain("RAW_");
  });

  it("serves the operational summary through the admin API", async () => {
    const repository = new InMemoryRomeoRepository();
    const oldDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await repository.createBackgroundJob({
      id: "job_api_queued_old",
      orgId: "org_default",
      type: "knowledge.extract",
      status: "queued",
      payload: { sourceText: "RAW_API_JOB_SECRET_SENTINEL" },
      createdAt: oldDate,
      updatedAt: oldDate,
    });

    const api = createRomeoApi(repository);
    const response = await api.request("/api/v1/jobs/operational-summary");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("critical");
    expect(body.data.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "queued_lag_seconds",
          type: "knowledge.extract",
          jobId: "job_api_queued_old",
        }),
      ]),
    );
    expect(JSON.stringify(body)).not.toContain("RAW_API_JOB_SECRET_SENTINEL");
  });
});
