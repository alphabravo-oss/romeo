import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { settingKey as abuseControlSettingKey } from "./abuse-control-policy-helpers";
import type { ChatService } from "./chat-service";
import {
  continueTelemetryContextFromPayload,
  telemetryTraceId,
} from "./telemetry-context";
import { WorkerSupervisor } from "./worker-supervisor";
import { deletionRequestKey } from "./tenant-admin-support";

export interface TemporaryChatCleanupWorkerOptions {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  leaseSeconds: number;
  maxTenantsPerRun?: number;
  tenantConcurrency?: number;
  workerId?: string;
}

const tenantProgressKey = "scheduled-work.temporary-chat-cleanup.v1";

export class TemporaryChatCleanupWorker {
  private readonly workerId: string;
  private readonly supervisor = new WorkerSupervisor("temporary_chat_cleanup");

  constructor(
    private readonly repository: RomeoRepository,
    private readonly chats: ChatService,
    private readonly options: TemporaryChatCleanupWorkerOptions,
  ) {
    this.workerId =
      options.workerId ?? createId("temporary_chat_cleanup_worker");
  }

  start(): void {
    if (!this.options.enabled) return;
    this.supervisor.start((signal) => this.runOnce(undefined, signal), {
      intervalMs: this.options.intervalMs,
      maxBackoffMs: this.options.intervalMs * 16,
      jitterRatio: 0.2,
    });
  }

  stop(): void {
    this.supervisor.stop();
  }

  drain(): Promise<void> {
    return this.supervisor.drain();
  }

  async runOnce(
    now = new Date().toISOString(),
    signal?: AbortSignal,
  ): Promise<void> {
    const organizations = (await this.repository.listAllOrganizations()).sort(
      (left, right) => left.id.localeCompare(right.id),
    );
    const previous = await this.repository.getSystemSetting(
      tenantProgressKey,
      null,
    );
    const cursor =
      typeof previous?.value.cursorOrgId === "string"
        ? previous.value.cursorOrgId
        : undefined;
    const pivot = organizations.findIndex(
      (organization) => cursor === undefined || organization.id > cursor,
    );
    const ordered =
      pivot <= 0
        ? organizations
        : [...organizations.slice(pivot), ...organizations.slice(0, pivot)];
    const selected = ordered.slice(
      0,
      Math.max(1, Math.min(this.options.maxTenantsPerRun ?? 100, 1_000)),
    );
    const concurrency = Math.max(
      1,
      Math.min(this.options.tenantConcurrency ?? 4, 20),
    );
    let failed = 0;
    let processed = 0;
    let skipped = 0;
    for (let index = 0; index < selected.length; index += concurrency) {
      if (signal?.aborted === true) break;
      const batch = selected.slice(index, index + concurrency);
      const outcomes = await Promise.allSettled(
        batch.map((organization) =>
          this.runForOrganization(organization.id, now),
        ),
      );
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") failed += 1;
        else if (outcome.value === "skipped") skipped += 1;
        else processed += 1;
      }
      await this.repository.upsertSystemSetting(
        {
          key: tenantProgressKey,
          updatedAt: now,
          value: {
            version: 1,
            cursorOrgId: batch.at(-1)!.id,
            failed,
            processed,
            skipped,
            updatedAt: now,
          },
        },
        null,
      );
    }
  }

  runTenantOnce(
    orgId: string,
    now = new Date().toISOString(),
  ): Promise<"processed" | "skipped"> {
    return this.runForOrganization(orgId, now);
  }

  private async runForOrganization(
    orgId: string,
    now: string,
  ): Promise<"processed" | "skipped"> {
    if (!(await this.tenantCanRunScheduledWork(orgId))) return "skipped";
    const bucket = Math.floor(Date.parse(now) / this.options.intervalMs);
    const jobId = `temporary_chat_cleanup_${orgId}_${bucket}`;
    const existing = await this.repository.getBackgroundJob(orgId, jobId);
    if (existing === undefined) {
      try {
        await this.repository.createBackgroundJob({
          id: jobId,
          orgId,
          type: "temporary_chat.cleanup",
          status: "queued",
          payload: {
            batchSize: this.options.batchSize,
            requestId: jobId,
            traceId: telemetryTraceId({}),
          },
          createdAt: now,
          updatedAt: now,
        });
      } catch {
        // Another replica may have scheduled the same deterministic interval job.
      }
    }
    const claimed = await this.repository.claimBackgroundJob({
      orgId,
      type: "temporary_chat.cleanup",
      workerId: this.workerId,
      leaseSeconds: this.options.leaseSeconds,
      now,
    });
    if (claimed === undefined) {
      this.supervisor.recordLease({ claimed: false });
      return "processed";
    }
    this.supervisor.recordLease({
      claimed: true,
      lagMs: Math.max(0, Date.parse(now) - Date.parse(claimed.createdAt)),
    });
    continueTelemetryContextFromPayload(claimed.payload);
    try {
      const result = await this.chats.cleanupExpiredTemporaryChatsForWorker({
        orgId,
        batchSize: this.options.batchSize,
        now,
      });
      const completedAt = now;
      await this.repository.updateBackgroundJobWithLease({
        workerId: this.workerId,
        now,
        job: {
          ...claimed,
          status: "completed",
          payload: {
            ...claimed.payload,
            batchSize: this.options.batchSize,
            scanned: result.scanned,
            deleted: result.deletedChatIds.length,
            skippedLegalHold: result.skippedLegalHoldIds.length,
            deletedObjects: result.deletedObjectCount,
          },
          updatedAt: completedAt,
          completedAt,
        },
      });
    } catch {
      const completedAt = now;
      await this.repository.updateBackgroundJobWithLease({
        workerId: this.workerId,
        now,
        job: {
          ...claimed,
          status: "failed",
          payload: {
            ...claimed.payload,
            batchSize: this.options.batchSize,
            errorCode: "temporary_chat_cleanup_failed",
          },
          updatedAt: completedAt,
          completedAt,
        },
      });
    }
    return "processed";
  }

  private async tenantCanRunScheduledWork(orgId: string): Promise<boolean> {
    const [abuseControl, deletion] = await Promise.all([
      this.repository.getSystemSetting(abuseControlSettingKey(orgId), orgId),
      this.repository.getSystemSetting(deletionRequestKey(orgId), orgId),
    ]);
    const suspension = abuseControl?.value.suspension;
    const suspended =
      typeof suspension === "object" &&
      suspension !== null &&
      !Array.isArray(suspension) &&
      (suspension as Record<string, unknown>).suspended === true;
    return !suspended && deletion?.value.status !== "requested";
  }
}
