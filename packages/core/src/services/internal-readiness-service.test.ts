import type { RomeoEnv } from "@romeo/config";
import type { ObjectStore, ObjectStoreReadinessResult } from "@romeo/storage";
import { describe, expect, it } from "vitest";

import { testEnv } from "../test-support/env";
import type { QuotaCoordinator } from "./quota-coordination";
import {
  InternalReadinessService,
  RuntimeReadinessState,
} from "./internal-readiness-service";
import type { WorkerHealthSnapshot } from "./worker-health";

describe("internal dependency-aware readiness", () => {
  it("passes only bounded live dependency checks and returns generic statuses", async () => {
    const service = fixture();
    const result = await service.report();

    expect(result.status).toBe("ready");
    expect(result.checks).toEqual([
      { id: "configuration", status: "pass" },
      { id: "database", status: "pass" },
      { id: "migrations", status: "pass" },
      { id: "valkey", status: "pass" },
      { id: "object_storage", status: "pass" },
      { id: "scheduled_operations", status: "pass" },
    ]);
    const serialized = JSON.stringify(result);
    for (const secret of [
      "postgres://",
      "redis://",
      "secret-access-key",
      "SESSION_SECRET",
      "0036_exact_role_system_settings_rls",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each([
    [
      "database",
      { connected: false, migrationsCurrent: false, runtimeRoleSafe: false },
    ],
    [
      "migrations",
      { connected: true, migrationsCurrent: false, runtimeRoleSafe: true },
    ],
    [
      "database",
      { connected: true, migrationsCurrent: true, runtimeRoleSafe: false },
    ],
  ] as const)("fails closed for %s posture", async (id, databaseResult) => {
    const result = await fixture({ databaseResult }).report();
    expect(result.status).toBe("unready");
    expect(result.checks).toContainEqual({ id, status: "fail" });
    expect(JSON.stringify(result)).not.toMatch(
      /superuser|bypassrls|inherit|romeo_tenant_runtime|coordinator role/iu,
    );
  });

  it("fails closed for Valkey and object-store readback failures", async () => {
    const valkey = await fixture({ valkeyHealthy: false }).report();
    const objectStorage = await fixture({ objectReady: false }).report();

    expect(valkey.checks).toContainEqual({ id: "valkey", status: "fail" });
    expect(objectStorage.checks).toContainEqual({
      id: "object_storage",
      status: "fail",
    });
  });

  it("bounds a hung dependency and recovers on the next successful probe", async () => {
    let hung = true;
    const service = fixture({
      databaseCheck: (signal) =>
        hung
          ? new Promise((_resolve, reject) =>
              signal.addEventListener(
                "abort",
                () => reject(new Error("cancelled")),
                { once: true },
              ),
            )
          : Promise.resolve({
              connected: true,
              migrationsCurrent: true,
              runtimeRoleSafe: true,
            }),
      timeoutMs: 100,
    });

    expect((await service.report()).status).toBe("unready");
    hung = false;
    expect((await service.report()).status).toBe("ready");
  });

  it("becomes unready before graceful drain begins", async () => {
    const state = new RuntimeReadinessState();
    state.markStarted();
    const service = fixture({ state });
    expect((await service.report()).status).toBe("ready");

    state.markDraining();
    expect(await service.report()).toMatchObject({
      status: "unready",
      checks: [{ id: "scheduled_operations", status: "fail" }],
    });
  });

  it("requires fresh, healthy heartbeats from every internal essential scheduler", async () => {
    const now = Date.parse("2026-08-23T12:00:00.000Z");
    const state = new RuntimeReadinessState();
    state.markStarted();
    let snapshots = internalSnapshots(now - 1_000);
    const service = fixture({
      env: productionEnv({ SCHEDULED_TENANT_WORK_OWNER: "internal" }),
      now: () => now,
      state,
      workerSnapshots: () => snapshots,
    });

    expect((await service.report()).status).toBe("ready");
    snapshots = snapshots.map((snapshot) =>
      snapshot.worker === "scheduled_webhook_retry"
        ? { ...snapshot, state: "backoff", consecutiveFailures: 1 }
        : snapshot,
    );
    expect((await service.report()).checks).toContainEqual({
      id: "scheduled_operations",
      status: "fail",
    });
    snapshots = internalSnapshots(now - 1_000).map((snapshot) =>
      snapshot.worker === "scheduled_webhook_retry"
        ? withoutLastSuccess(snapshot)
        : snapshot,
    );
    expect((await service.report()).checks).toContainEqual({
      id: "scheduled_operations",
      status: "fail",
    });
  });

  it("requires fresh untampered external ownership evidence with exact operation coverage", async () => {
    const now = Date.parse("2026-08-23T12:00:00.000Z");
    const base = externalEvidence(now);
    for (const evidence of [
      "corrupt-evidence",
      { ...base, alertsConfigured: false },
      { ...base, status: "degraded" },
      { ...base, untrustedDetail: "secret scheduler error" },
      { ...base, observedAt: "2026-08-23T11:00:00.000Z" },
      { ...base, operations: base.operations.slice(1) },
      { ...base, operations: [...base.operations, "unapproved_operation"] },
    ]) {
      const result = await fixture({
        externalEvidence: evidence,
        now: () => now,
      }).report();
      expect(result.checks).toContainEqual({
        id: "scheduled_operations",
        status: "fail",
      });
      expect(JSON.stringify(result)).not.toContain("platform-operations");
      expect(JSON.stringify(result)).not.toContain("status.internal.example");
    }
  });

  it("single-flights concurrent expensive probes and reuses a fresh success", async () => {
    let resolveDatabase:
      | ((value: {
          connected: boolean;
          migrationsCurrent: boolean;
          runtimeRoleSafe: boolean;
        }) => void)
      | undefined;
    let databaseCalls = 0;
    let objectCalls = 0;
    const service = fixture({
      databaseCheck: () => {
        databaseCalls += 1;
        return new Promise((resolve) => {
          resolveDatabase = resolve;
        });
      },
      objectReadinessCheck: async () => {
        objectCalls += 1;
        return objectReadinessResult(true);
      },
      successTtlMs: 15_000,
    });
    const first = service.report();
    const second = service.report();
    await Promise.resolve();
    expect(databaseCalls).toBe(1);
    expect(objectCalls).toBe(1);
    resolveDatabase?.({
      connected: true,
      migrationsCurrent: true,
      runtimeRoleSafe: true,
    });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect((await service.report()).status).toBe("ready");
    expect(databaseCalls).toBe(1);
    expect(objectCalls).toBe(1);
  });
});

function fixture(
  options: {
    databaseCheck?: (signal: AbortSignal) => Promise<{
      connected: boolean;
      migrationsCurrent: boolean;
      runtimeRoleSafe: boolean;
    }>;
    databaseResult?: {
      connected: boolean;
      migrationsCurrent: boolean;
      runtimeRoleSafe: boolean;
    };
    env?: RomeoEnv;
    externalEvidence?: unknown;
    failureTtlMs?: number;
    now?: () => number;
    objectReady?: boolean;
    objectReadinessCheck?: (
      signal?: AbortSignal,
    ) => Promise<ObjectStoreReadinessResult>;
    state?: RuntimeReadinessState;
    successTtlMs?: number;
    timeoutMs?: number;
    valkeyHealthy?: boolean;
    workerSnapshots?: () => WorkerHealthSnapshot[];
  } = {},
) {
  const state = options.state ?? new RuntimeReadinessState();
  state.markStarted();
  return new InternalReadinessService(
    options.env ?? productionEnv(),
    state,
    objectStore(options.objectReady ?? true, options.objectReadinessCheck),
    quotaCoordinator(options.valkeyHealthy ?? true),
    {
      databaseProbe: {
        check: (signal) =>
          options.databaseCheck?.(signal) ??
          Promise.resolve(
            options.databaseResult ?? {
              connected: true,
              migrationsCurrent: true,
              runtimeRoleSafe: true,
            },
          ),
      },
      failureTtlMs: options.failureTtlMs ?? 0,
      readExternalSchedulerEvidence: async () =>
        options.externalEvidence ??
        externalEvidence((options.now ?? Date.now)()),
      successTtlMs: options.successTtlMs ?? 0,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.workerSnapshots === undefined
        ? {}
        : { workerSnapshots: options.workerSnapshots }),
    },
  );
}

function productionEnv(overrides: Partial<RomeoEnv> = {}): RomeoEnv {
  return {
    ...testEnv(),
    ROMEO_ENV: "production",
    REPOSITORY_DRIVER: "postgres",
    OBJECT_STORE_DRIVER: "s3",
    QUOTA_COORDINATION_DRIVER: "valkey",
    SESSION_SECRET: "production-session-secret-material-32",
    MANAGED_SECRET_ENCRYPTION_KEY: "managed-secret-encryption-material-32",
    WEBHOOK_SIGNING_KEY: "webhook-signing-material-32",
    TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY: "tool-dispatch-payload-material-32",
    SCHEDULED_TENANT_WORK_OWNER: "external",
    BILLING_ENABLED: false,
    MODEL_CATALOG_SYNC_ENABLED: false,
    TEMPORARY_CHAT_CLEANUP_ENABLED: false,
    SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_PATH:
      "/evidence/scheduled-operations.json",
    SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_MAX_AGE_SECONDS: 900,
    ...overrides,
  } as RomeoEnv;
}

function objectStore(
  ready: boolean,
  check?: (signal?: AbortSignal) => Promise<ObjectStoreReadinessResult>,
): ObjectStore {
  return {
    checkReadiness(signal): Promise<ObjectStoreReadinessResult> {
      return check?.(signal) ?? Promise.resolve(objectReadinessResult(ready));
    },
  } as ObjectStore;
}

function objectReadinessResult(ready: boolean): ObjectStoreReadinessResult {
  return {
    authenticated: ready,
    deleteVerified: ready,
    encryptionConfigured: ready,
    lifecycleConfigured: ready,
    readAfterWriteVerified: ready,
    ready,
    replicationConfigured: ready,
    tlsEnabled: ready,
    versioningEnabled: ready,
    writeVerified: ready,
  };
}

function quotaCoordinator(healthy: boolean): QuotaCoordinator {
  return {
    async status() {
      return {
        checkedAt: "2026-08-23T12:00:00.000Z",
        configured: true,
        details: {
          failClosed: true,
          statusCode: healthy ? "healthy" : "unreachable",
        },
        driver: "valkey",
        enabled: true,
        healthy,
        keyPrefix: "romeo:test",
      };
    },
  } as QuotaCoordinator;
}

function internalSnapshots(timestamp: number): WorkerHealthSnapshot[] {
  return [
    "scheduled_table_export",
    "scheduled_file_lifecycle",
    "scheduled_content_deletion",
    "scheduled_run_terminal_outbox",
    "scheduled_retention_enforcement",
    "scheduled_webhook_retry",
    "scheduled_notification_retry",
    "scheduled_voice_catalog_sync",
  ].map((worker) => ({
    worker,
    state: "idle",
    running: false,
    consecutiveFailures: 0,
    iterationCount: 1,
    successCount: 1,
    failureCount: 0,
    skippedOverlapCount: 0,
    leaseClaimCount: 1,
    leaseMissCount: 0,
    scheduleLagMs: 0,
    leaseLagMs: 0,
    lastCompletedAt: new Date(timestamp).toISOString(),
    lastSuccessAt: new Date(timestamp).toISOString(),
  }));
}

function withoutLastSuccess(
  snapshot: WorkerHealthSnapshot,
): WorkerHealthSnapshot {
  const without = { ...snapshot };
  delete without.lastSuccessAt;
  return { ...without, state: "running" };
}

function externalEvidence(now: number) {
  return {
    schemaVersion: "romeo.external-scheduled-operations.v1",
    owner: "platform-operations",
    observedAt: new Date(now).toISOString(),
    status: "healthy",
    statusReference: "https://status.internal.example/scheduled-operations",
    alertsConfigured: true,
    operations: [
      "table_export",
      "file_lifecycle",
      "content_deletion",
      "run_terminal_outbox",
      "retention_enforcement",
      "webhook_retry",
      "notification_retry",
      "voice_catalog_sync",
    ],
  };
}
