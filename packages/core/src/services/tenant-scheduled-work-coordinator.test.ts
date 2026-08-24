import { describe, expect, it, vi } from "vitest";

import type { RomeoRepository } from "../domain/repository";
import type { RepositoryRequestScope } from "../domain/repository-request-scope";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import {
  type ScheduledTenantOperation,
  TenantScheduledWorkCoordinator,
} from "./tenant-scheduled-work-coordinator";

const now = "2026-08-23T12:00:00.000Z";

describe("TenantScheduledWorkCoordinator", () => {
  it("rotates fairly, skips suspended/deleting tenants, and isolates partial failures", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedTenants(repository, ["org_a", "org_b", "org_c", "org_d"]);
    await repository.upsertSystemSetting(
      {
        key: "abuse_controls.org.v1:org_b",
        updatedAt: now,
        value: { suspension: { suspended: true } },
      },
      "org_b",
    );
    await repository.upsertSystemSetting(
      {
        key: "tenant_lifecycle.deletion_request.v1:org_c",
        updatedAt: now,
        value: { status: "requested" },
      },
      "org_c",
    );
    const visited: string[] = [];
    const operation = testOperation(async (orgId) => {
      visited.push(orgId);
      if (orgId === "org_d") throw new Error("injected_failure");
    });
    const first = new TenantScheduledWorkCoordinator(
      inMemoryScope(repository),
      [operation],
      {
        maxTenantsPerRun: 3,
        now: fixedNow,
        tenantConcurrency: 2,
        workerId: "scheduled_first",
      },
    );
    const firstReport = await first.runOnce(operation.name, now);
    expect(firstReport.selectedTenants).toBe(3);
    expect(firstReport.skippedTenants).toBe(2);
    expect(firstReport.succeeded).toBe(1);

    const restarted = new TenantScheduledWorkCoordinator(
      inMemoryScope(repository),
      [operation],
      {
        maxTenantsPerRun: 3,
        now: fixedNow,
        tenantConcurrency: 2,
        workerId: "scheduled_restart",
      },
    );
    const restartReport = await restarted.runOnce(operation.name, now);
    expect(restartReport.failed).toBe(1);
    expect(visited).toContain("org_d");
  });

  it("suppresses duplicate schedulers with a deterministic leased tenant job", async () => {
    const repository = new InMemoryRomeoRepository();
    let calls = 0;
    const operation = testOperation(async () => {
      calls += 1;
    });
    const first = new TenantScheduledWorkCoordinator(
      inMemoryScope(repository),
      [operation],
      { now: fixedNow, workerId: "replica_a" },
    );
    const duplicate = new TenantScheduledWorkCoordinator(
      inMemoryScope(repository),
      [operation],
      { now: fixedNow, workerId: "replica_b" },
    );

    const completed = await first.runOnce(operation.name, now);
    const suppressed = await duplicate.runOnce(operation.name, now);

    expect(completed.succeeded).toBe(1);
    expect(suppressed.claimed).toBe(0);
    expect(calls).toBe(1);
  });

  it("renews a long-running lease so another replica cannot take over", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(now));
      const repository = new InMemoryRomeoRepository();
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let finish: (() => void) | undefined;
      const operation = testOperation(
        () =>
          new Promise<void>((resolve) => {
            markStarted?.();
            finish = resolve;
          }),
      );
      const first = new TenantScheduledWorkCoordinator(
        inMemoryScope(repository),
        [operation],
        { now: () => new Date(Date.now()), workerId: "long_replica" },
      );
      const takeover = new TenantScheduledWorkCoordinator(
        inMemoryScope(repository),
        [operation],
        { now: () => new Date(Date.now()), workerId: "takeover_replica" },
      );
      const active = first.runOnce(operation.name, now);
      await started;
      await vi.advanceTimersByTimeAsync(61_000);

      const takeoverReport = await takeover.runOnce(
        operation.name,
        new Date(Date.now()).toISOString(),
      );
      expect(takeoverReport.claimed).toBe(0);

      finish?.();
      await active;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fences a stale completion even when a restarted replica reuses a worker id", async () => {
    const repository = new InMemoryRomeoRepository();
    const job = await repository.createBackgroundJob({
      id: "scheduled_test_operation_org_default_0",
      orgId: "org_default",
      type: "scheduled.test_operation",
      status: "queued",
      payload: { operation: "test_operation", version: 1 },
      createdAt: now,
      updatedAt: now,
    });
    const first = await repository.claimBackgroundJob({
      jobId: job.id,
      leaseSeconds: 60,
      now,
      orgId: job.orgId,
      type: job.type,
      workerId: "stable_worker_identity",
    });
    const takeoverAt = "2026-08-23T12:01:01.000Z";
    const takeover = await repository.claimBackgroundJob({
      jobId: job.id,
      leaseSeconds: 60,
      now: takeoverAt,
      orgId: job.orgId,
      type: job.type,
      workerId: "stable_worker_identity",
    });
    expect(workerLeaseAttempt(first)).toBe(1);
    expect(workerLeaseAttempt(takeover)).toBe(2);
    expect(
      await repository.updateBackgroundJobWithLease({
        job: { ...first!, status: "completed", updatedAt: takeoverAt },
        leaseAttempt: 1,
        now: takeoverAt,
        workerId: "stable_worker_identity",
      }),
    ).toBeUndefined();
    expect(
      await repository.updateBackgroundJobWithLease({
        job: { ...takeover!, status: "completed", updatedAt: takeoverAt },
        leaseAttempt: 2,
        now: takeoverAt,
        workerId: "stable_worker_identity",
      }),
    ).toMatchObject({ status: "completed" });
  });

  it("aborts active tenant work and drains without starting another iteration", async () => {
    const repository = new InMemoryRomeoRepository();
    let iterations = 0;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const operation: ScheduledTenantOperation = {
      intervalMs: 60_000,
      name: "abortable_operation",
      scopes: ["admin:write"],
      run: ({ signal }) => {
        iterations += 1;
        markStarted?.();
        return new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("worker_aborted")),
            { once: true },
          );
        });
      },
    };
    const coordinator = new TenantScheduledWorkCoordinator(
      inMemoryScope(repository),
      [operation],
      { now: fixedNow, workerId: "abortable_replica" },
    );
    coordinator.start();
    await started;
    coordinator.stop();
    await coordinator.drain();
    expect(iterations).toBe(1);
  });
});

function fixedNow(): Date {
  return new Date(now);
}

function workerLeaseAttempt(
  job: Awaited<ReturnType<RomeoRepository["claimBackgroundJob"]>>,
): number | undefined {
  const lease = job?.payload.workerLease;
  return typeof lease === "object" && lease !== null && !Array.isArray(lease)
    ? (lease as { attempt?: number }).attempt
    : undefined;
}

function testOperation(
  run: (orgId: string) => Promise<void>,
): ScheduledTenantOperation {
  return {
    intervalMs: 60_000,
    name: "test_operation",
    scopes: ["admin:write"],
    run: ({ subject }) => run(subject.orgId),
  };
}

function inMemoryScope(repository: RomeoRepository): RepositoryRequestScope {
  return {
    runAsSystem: (work) => repository.transaction(work),
    runAsTenant: (_orgId, work) => repository.transaction(work),
  };
}

async function seedTenants(
  repository: RomeoRepository,
  orgIds: string[],
): Promise<void> {
  for (const orgId of orgIds) {
    await repository.createOrganization({
      id: orgId,
      name: orgId,
      slug: orgId,
    });
    await repository.createWorkspace({
      id: `workspace_${orgId}`,
      orgId,
      name: orgId,
      slug: orgId,
    });
  }
}
