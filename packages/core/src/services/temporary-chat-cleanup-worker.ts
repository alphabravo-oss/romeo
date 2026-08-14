import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import type { ChatService } from "./chat-service";
import {
  continueTelemetryContextFromPayload,
  telemetryTraceId,
} from "./telemetry-context";
import { WorkerSupervisor } from "./worker-supervisor";

export interface TemporaryChatCleanupWorkerOptions {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  leaseSeconds: number;
  workerId?: string;
}

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
    const organizations = await this.repository.listAllOrganizations();
    await Promise.all(
      organizations.map((organization) => {
        if (signal?.aborted === true) return Promise.resolve();
        return this.runForOrganization(organization.id, now);
      }),
    );
  }

  private async runForOrganization(orgId: string, now: string): Promise<void> {
    const bucket = Math.floor(Date.parse(now) / this.options.intervalMs);
    const jobId = `temporary_chat_cleanup_${orgId}_${bucket}`;
    const existing = (await this.repository.listBackgroundJobs(orgId)).find(
      (job) => job.id === jobId,
    );
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
      return;
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
  }
}
