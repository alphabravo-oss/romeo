import type { RomeoEnv } from "@romeo/config";
import type { InternalReadinessReport } from "@romeo/contracts";
import type { ObjectStore } from "@romeo/storage";
import { open } from "node:fs/promises";

import type { QuotaCoordinator } from "./quota-coordination";
import {
  listWorkerHealthSnapshots,
  type WorkerHealthSnapshot,
} from "./worker-health";

export interface DatabaseReadinessResult {
  connected: boolean;
  migrationsCurrent: boolean;
  runtimeRoleSafe: boolean;
}

export interface RuntimeDatabaseReadinessProbe {
  check(signal: AbortSignal): Promise<DatabaseReadinessResult>;
}

export interface InternalReadinessServiceOptions {
  databaseProbe?: RuntimeDatabaseReadinessProbe;
  failureTtlMs?: number;
  now?: () => number;
  readExternalSchedulerEvidence?: (path: string) => Promise<unknown>;
  successTtlMs?: number;
  timeoutMs?: number;
  workerSnapshots?: () => WorkerHealthSnapshot[];
}

type CheckId = InternalReadinessReport["checks"][number]["id"];
type Check = InternalReadinessReport["checks"][number];

export class RuntimeReadinessState {
  private accepting = true;
  private workersStarted = false;

  markDraining(): void {
    this.accepting = false;
  }

  markStarted(): void {
    this.accepting = true;
    this.workersStarted = true;
  }

  snapshot(): { accepting: boolean; workersStarted: boolean } {
    return { accepting: this.accepting, workersStarted: this.workersStarted };
  }
}

export class InternalReadinessService {
  private readonly databaseCache: SingleFlightProbe<DatabaseReadinessResult>;
  private readonly now: () => number;
  private readonly objectStorageCache: SingleFlightProbe<boolean>;
  private readonly readExternalSchedulerEvidence: (
    path: string,
  ) => Promise<unknown>;
  private readonly timeoutMs: number;
  private readonly valkeyCache: SingleFlightProbe<boolean>;
  private readonly workerSnapshots: () => WorkerHealthSnapshot[];

  constructor(
    private readonly env: RomeoEnv,
    private readonly state: RuntimeReadinessState,
    private readonly objectStore: ObjectStore,
    private readonly quotaCoordinator: QuotaCoordinator,
    private readonly options: InternalReadinessServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = Math.max(
      100,
      Math.min(options.timeoutMs ?? 2_000, 10_000),
    );
    this.workerSnapshots = options.workerSnapshots ?? listWorkerHealthSnapshots;
    this.readExternalSchedulerEvidence =
      options.readExternalSchedulerEvidence ?? readJsonFile;
    const cacheOptions = {
      failureTtlMs: boundedTtl(options.failureTtlMs, 1_000),
      now: this.now,
      successTtlMs: boundedTtl(options.successTtlMs, 15_000),
    };
    this.databaseCache = new SingleFlightProbe(
      (result) =>
        result.connected && result.migrationsCurrent && result.runtimeRoleSafe,
      cacheOptions,
    );
    this.objectStorageCache = new SingleFlightProbe<boolean>(
      (value) => value,
      cacheOptions,
    );
    this.valkeyCache = new SingleFlightProbe<boolean>(
      (value) => value,
      cacheOptions,
    );
  }

  async report(): Promise<InternalReadinessReport> {
    const state = this.state.snapshot();
    if (!state.accepting)
      return report([fail("scheduled_operations")], this.now);

    const [database, valkey, objectStorage, scheduledOperations] =
      await Promise.all([
        this.databaseChecks(),
        this.valkeyCheck(),
        this.objectStorageCheck(),
        this.scheduledOperationsCheck(state.workersStarted),
      ]);
    const checks: Check[] = [
      configurationCheck(this.env),
      ...database,
      valkey,
      objectStorage,
      scheduledOperations,
    ];
    return report(checks, this.now);
  }

  private async databaseChecks(): Promise<Check[]> {
    if (this.env.REPOSITORY_DRIVER !== "postgres") {
      const status = this.env.ROMEO_ENV === "production" ? "fail" : "pass";
      return [
        { id: "database", status },
        { id: "migrations", status },
      ];
    }
    const probe = this.options.databaseProbe;
    if (probe === undefined) return [fail("database"), fail("migrations")];
    const result = await boundedProbe(
      (signal) => this.databaseCache.read(() => probe.check(signal)),
      this.timeoutMs,
    );
    if (result === undefined) return [fail("database"), fail("migrations")];
    return [
      result.connected && result.runtimeRoleSafe
        ? pass("database")
        : fail("database"),
      result.connected && result.migrationsCurrent
        ? pass("migrations")
        : fail("migrations"),
    ];
  }

  private async valkeyCheck(): Promise<Check> {
    if (this.env.QUOTA_COORDINATION_DRIVER !== "valkey") {
      return this.env.ROMEO_ENV === "production"
        ? fail("valkey")
        : pass("valkey");
    }
    const healthy = await boundedProbe(
      () =>
        this.valkeyCache.read(async () => {
          const status = await this.quotaCoordinator.status();
          return status.healthy === true;
        }),
      this.timeoutMs,
    );
    return healthy === true ? pass("valkey") : fail("valkey");
  }

  private async objectStorageCheck(): Promise<Check> {
    if (this.env.OBJECT_STORE_DRIVER !== "s3") {
      return this.env.ROMEO_ENV === "production"
        ? fail("object_storage")
        : pass("object_storage");
    }
    if (this.objectStore.checkReadiness === undefined)
      return fail("object_storage");
    const ready = await boundedProbe(
      (signal) =>
        this.objectStorageCache.read(async () => {
          const status = await this.objectStore.checkReadiness!(signal);
          return (
            status.ready === true &&
            status.authenticated &&
            status.deleteVerified &&
            (!this.env.S3_READINESS_REQUIRE_ENCRYPTION ||
              status.encryptionConfigured) &&
            (!this.env.S3_READINESS_REQUIRE_LIFECYCLE ||
              status.lifecycleConfigured) &&
            status.readAfterWriteVerified &&
            (!this.env.S3_READINESS_REQUIRE_REPLICATION ||
              status.replicationConfigured) &&
            status.tlsEnabled &&
            (!this.env.S3_READINESS_REQUIRE_VERSIONING ||
              status.versioningEnabled) &&
            status.writeVerified
          );
        }),
      this.timeoutMs,
    );
    return ready === true ? pass("object_storage") : fail("object_storage");
  }

  private async scheduledOperationsCheck(
    workersStarted: boolean,
  ): Promise<Check> {
    if (this.env.REPOSITORY_DRIVER !== "postgres")
      return pass("scheduled_operations");
    if (this.env.SCHEDULED_TENANT_WORK_OWNER === "external") {
      return (await validExternalSchedulerEvidence(
        this.env,
        this.now(),
        this.readExternalSchedulerEvidence,
      ))
        ? pass("scheduled_operations")
        : fail("scheduled_operations");
    }
    return internalScheduledOperationsReady(
      this.env,
      workersStarted,
      this.workerSnapshots(),
      this.now(),
    )
      ? pass("scheduled_operations")
      : fail("scheduled_operations");
  }
}

function configurationCheck(env: RomeoEnv): Check {
  if (env.ROMEO_ENV !== "production") return pass("configuration");
  const ready =
    env.REPOSITORY_DRIVER === "postgres" &&
    env.OBJECT_STORE_DRIVER === "s3" &&
    env.QUOTA_COORDINATION_DRIVER === "valkey" &&
    env.SESSION_SECRET.length >= 32 &&
    env.MANAGED_SECRET_ENCRYPTION_KEY.length >= 32 &&
    env.WEBHOOK_SIGNING_KEY.length >= 16 &&
    (env.TOOL_DISPATCH_PAYLOAD_STORE_DRIVER !== "object-store" ||
      env.TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY.length >= 32);
  return ready ? pass("configuration") : fail("configuration");
}

function internalScheduledOperationsReady(
  env: RomeoEnv,
  workersStarted: boolean,
  snapshots: WorkerHealthSnapshot[],
  now: number,
): boolean {
  if (!workersStarted) return false;
  const byName = new Map(
    snapshots.map((snapshot) => [snapshot.worker, snapshot]),
  );
  for (const expected of expectedWorkers(env)) {
    const snapshot = byName.get(expected.name);
    if (
      snapshot === undefined ||
      snapshot.state === "stopped" ||
      snapshot.state === "backoff" ||
      snapshot.consecutiveFailures > 0
    ) {
      return false;
    }
    const heartbeat = snapshot.lastSuccessAt;
    if (
      heartbeat === undefined ||
      !Number.isFinite(Date.parse(heartbeat)) ||
      Date.parse(heartbeat) > now + 60_000 ||
      now - Date.parse(heartbeat) > expected.maxAgeMs
    ) {
      return false;
    }
  }
  return true;
}

async function validExternalSchedulerEvidence(
  env: RomeoEnv,
  now: number,
  readEvidence: (path: string) => Promise<unknown>,
): Promise<boolean> {
  const path = env.SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_PATH.trim();
  const maxAgeSeconds =
    env.SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_MAX_AGE_SECONDS;
  if (path.length === 0) return false;
  const value = await boundedProbe(() => readEvidence(path), 1_000);
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const allowedKeys = [
    "alertsConfigured",
    "observedAt",
    "operations",
    "owner",
    "schemaVersion",
    "status",
    "statusReference",
  ].sort();
  if (
    keys.length !== allowedKeys.length ||
    keys.some((key, index) => key !== allowedKeys[index])
  )
    return false;
  if (
    value.schemaVersion !== "romeo.external-scheduled-operations.v1" ||
    typeof value.owner !== "string" ||
    value.owner.trim().length < 3 ||
    value.status !== "healthy" ||
    value.alertsConfigured !== true ||
    typeof value.statusReference !== "string" ||
    value.statusReference.trim().length < 3 ||
    typeof value.observedAt !== "string"
  ) {
    return false;
  }
  const observedAt = Date.parse(value.observedAt);
  if (
    !Number.isFinite(observedAt) ||
    observedAt > now + 60_000 ||
    now - observedAt > maxAgeSeconds * 1_000
  ) {
    return false;
  }
  if (!Array.isArray(value.operations)) return false;
  const observed = value.operations
    .filter((operation): operation is string => typeof operation === "string")
    .sort();
  const expected = expectedOperationNames(env).sort();
  return (
    observed.length === expected.length &&
    observed.every((operation, index) => operation === expected[index])
  );
}

function expectedWorkers(
  env: RomeoEnv,
): Array<{ maxAgeMs: number; name: string }> {
  const expected = [
    worker("table_export", 1_000),
    worker("file_lifecycle", 1_000),
    worker("content_deletion", 1_000),
    worker("run_terminal_outbox", 1_000),
    worker("retention_enforcement", 24 * 60 * 60 * 1_000),
    worker("webhook_retry", 10_000),
    worker("notification_retry", 10_000),
    worker("voice_catalog_sync", 24 * 60 * 60 * 1_000),
  ];
  if (env.TEMPORARY_CHAT_CLEANUP_ENABLED)
    expected.push(
      worker("temporary_chat_cleanup", env.TEMPORARY_CHAT_CLEANUP_INTERVAL_MS),
    );
  if (env.MODEL_CATALOG_SYNC_ENABLED)
    expected.push(
      worker("provider_catalog_sync", env.MODEL_CATALOG_SYNC_INTERVAL_MS),
    );
  if (env.BILLING_ENABLED) {
    expected.push(
      worker("billing_entitlement_reconciliation", 5 * 60 * 1_000),
      worker("billing_lifecycle_enforcement", 15 * 60 * 1_000),
    );
  }
  return expected;
}

function expectedOperationNames(env: RomeoEnv): string[] {
  return expectedWorkers(env).map((expected) =>
    expected.name.replace(/^scheduled_/u, ""),
  );
}

function worker(operation: string, intervalMs: number) {
  return workerName(`scheduled_${operation}`, intervalMs);
}

function workerName(name: string, intervalMs: number) {
  return { name, maxAgeMs: Math.max(30_000, intervalMs * 2) };
}

async function boundedProbe<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(undefined);
        }, timeoutMs);
        timer.unref?.();
      }),
    ]).catch(() => undefined);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

class SingleFlightProbe<T> {
  private cached:
    | { checkedAt: number; success: boolean; value: T | undefined }
    | undefined;
  private inFlight: Promise<T | undefined> | undefined;

  constructor(
    private readonly isSuccess: (value: T) => boolean,
    private readonly options: {
      failureTtlMs: number;
      now: () => number;
      successTtlMs: number;
    },
  ) {}

  read(work: () => Promise<T | undefined>): Promise<T | undefined> {
    const cached = this.cached;
    if (cached !== undefined) {
      const ttl = cached.success
        ? this.options.successTtlMs
        : this.options.failureTtlMs;
      if (this.options.now() - cached.checkedAt < ttl)
        return Promise.resolve(cached.value);
    }
    if (this.inFlight !== undefined) return this.inFlight;
    const pending = work()
      .catch(() => undefined)
      .then((value) => {
        this.cached = {
          checkedAt: this.options.now(),
          success: value !== undefined && this.isSuccess(value),
          value,
        };
        return value;
      })
      .finally(() => {
        if (this.inFlight === pending) this.inFlight = undefined;
      });
    this.inFlight = pending;
    return pending;
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  const handle = await open(path, "r");
  try {
    const maximumBytes = 64 * 1024;
    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maximumBytes)
      throw new Error("external_scheduler_evidence_too_large");
    return JSON.parse(
      buffer.subarray(0, bytesRead).toString("utf8"),
    ) as unknown;
  } finally {
    await handle.close();
  }
}

function boundedTtl(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.min(Math.floor(value ?? fallback), 60_000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function report(checks: Check[], now: () => number): InternalReadinessReport {
  return {
    status: checks.every((check) => check.status === "pass")
      ? "ready"
      : "unready",
    generatedAt: new Date(now()).toISOString(),
    checks,
  };
}

function pass(id: CheckId): Check {
  return { id, status: "pass" };
}

function fail(id: CheckId): Check {
  return { id, status: "fail" };
}
