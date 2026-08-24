import { seededSubject } from "@romeo/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256, type AuditIntegrityRecord } from "../domain/audit-integrity";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import {
  AuditIntegrityService,
  VersionedHmacAuditCheckpointSigner,
  authorizeAuditExportJob,
  type AuditCheckpointSigner,
  type AuditExportClient,
} from "./audit-integrity";

const oldKey = "old-audit-checkpoint-key-material-32-bytes-minimum";
const newKey = "new-audit-checkpoint-key-material-32-bytes-minimum";

describe("audit integrity", () => {
  afterEach(() => vi.useRealTimers());

  it("creates canonical monotonic tenant records and seals stored data only", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedAudits(repository);
    const service = serviceFor(repository);
    const sealed = await service.seal({ subject: seededSubject });
    expect(sealed.outcome).toBe("accepted");
    if (sealed.outcome !== "accepted") return;
    expect(sealed.checkpoint).toMatchObject({
      algorithm: "hmac-sha256",
      fromSequence: 1,
      recordCount: 3,
      toSequence: 3,
    });
    const records = await repository.listAuditIntegrityRecords(
      seededSubject.orgId,
    );
    expect(records.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(records[1]!.previousHash).toBe(records[0]!.recordHash);
    expect(
      await service.verifyCheckpoint({ checkpoint: sealed.checkpoint }),
    ).toEqual({ outcome: "accepted" });
    expect(await service.seal({ subject: seededSubject })).toEqual({
      code: "audit_segment_empty",
      outcome: "denied",
    });
  });

  it("detects the content/order/deletion/insertion/chain/root/signature/key/tenant tamper matrix", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedAudits(repository);
    const service = serviceFor(repository);
    const sealed = await service.seal({ subject: seededSubject });
    if (sealed.outcome !== "accepted") throw new Error("fixture did not seal");
    const records = await repository.listAuditIntegrityRecords(
      seededSubject.orgId,
    );
    const cases: Array<{
      code: string;
      checkpoint?: typeof sealed.checkpoint;
      records?: AuditIntegrityRecord[];
    }> = [
      {
        code: "record_content_modified",
        records: replace(records, 1, {
          ...records[1]!,
          canonicalPayload: {
            ...records[1]!.canonicalPayload,
            resourceId: "tampered",
          },
        }),
      },
      {
        code: "record_order_modified",
        records: [records[1]!, records[0]!, records[2]!],
      },
      { code: "record_count_mismatch", records: records.slice(0, 2) },
      { code: "record_count_mismatch", records: [...records, records[2]!] },
      {
        code: "record_chain_broken",
        records: replace(records, 1, {
          ...records[1]!,
          previousHash: "f".repeat(64),
        }),
      },
      {
        code: "checkpoint_root_mismatch",
        checkpoint: { ...sealed.checkpoint, rootHash: "e".repeat(64) },
      },
      {
        code: "checkpoint_signature_invalid",
        checkpoint: { ...sealed.checkpoint, signature: "d".repeat(64) },
      },
      {
        code: "checkpoint_range_mismatch",
        checkpoint: { ...sealed.checkpoint, recordCount: 2 },
      },
      {
        code: "checkpoint_unknown_key_version",
        checkpoint: { ...sealed.checkpoint, keyVersion: "retired-unknown" },
      },
      {
        code: "cross_tenant_record",
        records: replace(records, 1, { ...records[1]!, orgId: "org_other" }),
      },
    ];
    for (const item of cases) {
      expect(
        await service.verifyCheckpoint({
          checkpoint: item.checkpoint ?? sealed.checkpoint,
          records: item.records ?? records,
        }),
      ).toMatchObject({ code: item.code, outcome: "denied" });
    }
  });

  it("verifies historical checkpoints after signing-key rotation", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedAudits(repository);
    const oldSigner = new VersionedHmacAuditCheckpointSigner({
      activeKeyVersion: "audit-key.2026-01",
      keys: { "audit-key.2026-01": oldKey },
    });
    const sealed = await new AuditIntegrityService(repository, oldSigner).seal({
      subject: seededSubject,
    });
    if (sealed.outcome !== "accepted") throw new Error("fixture did not seal");
    const rotatedSigner = new VersionedHmacAuditCheckpointSigner({
      activeKeyVersion: "audit-key.2026-08",
      keys: {
        "audit-key.2026-01": oldKey,
        "audit-key.2026-08": newKey,
      },
    });
    expect(
      await new AuditIntegrityService(
        repository,
        rotatedSigner,
      ).verifyCheckpoint({
        checkpoint: sealed.checkpoint,
      }),
    ).toEqual({ outcome: "accepted" });
  });

  it("supports asynchronous protected signer implementations", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedAudits(repository);
    const local = signer();
    const protectedSigner: AuditCheckpointSigner = {
      activeAlgorithm: local.activeAlgorithm,
      activeKeyVersion: local.activeKeyVersion,
      hasKeyVersion: async (keyVersion) => local.hasKeyVersion(keyVersion),
      sign: async (payload) => local.sign(payload),
      verify: async (input) => local.verify(input),
    };
    const service = new AuditIntegrityService(repository, protectedSigner);
    const sealed = await service.seal({ subject: seededSubject });
    if (sealed.outcome !== "accepted") throw new Error("fixture did not seal");
    await expect(
      service.verifyCheckpoint({ checkpoint: sealed.checkpoint }),
    ).resolves.toEqual({ outcome: "accepted" });
  });

  it("continues the protected sequence after permitted retention pruning", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedAudits(repository);
    expect(
      await repository.deleteAuditLogsBefore(
        seededSubject.orgId,
        "2026-08-23T12:04:00.000Z",
      ),
    ).toBe(3);
    await repository.createAuditLog({
      action: "local_auth.login",
      actorId: seededSubject.id,
      createdAt: "2026-08-23T12:04:00.000Z",
      id: "audit_integrity_after_retention",
      metadata: {},
      orgId: seededSubject.orgId,
      outcome: "success",
      resourceId: "session_after_retention",
      resourceType: "session",
    });
    const service = serviceFor(repository);
    const sealed = await service.seal({ subject: seededSubject });
    expect(sealed.outcome).toBe("accepted");
    if (sealed.outcome !== "accepted") return;
    expect(sealed.checkpoint).toMatchObject({
      fromSequence: 4,
      recordCount: 1,
      toSequence: 4,
    });
    expect(
      await service.verifyCheckpoint({ checkpoint: sealed.checkpoint }),
    ).toEqual({ outcome: "accepted" });
  });

  it("persists jobs, attempts, receipts and verified WORM readback", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedAudits(repository);
    let deliveredPayloadHash = "";
    const acknowledgementHash = sha256("ack-worm-1");
    const client: AuditExportClient = {
      deliver: async ({ job, payload }) => {
        deliveredPayloadHash = sha256(payload);
        return {
          acknowledgementHash,
          destinationRangeEnd: String(job.toSequence),
          destinationRangeStart: String(job.fromSequence),
        };
      },
      readback: async ({ acknowledgementHash, job }) => ({
        acknowledgementHash,
        checkpointHash: job.checkpointHash,
        destinationRangeEnd: String(job.toSequence),
        destinationRangeStart: String(job.fromSequence),
        payloadHash: deliveredPayloadHash,
        retentionLockEvidence: "object-lock:compliance-until-2033-01-01",
      }),
    };
    const service = serviceFor(repository, client);
    const sealed = await service.seal({ subject: seededSubject });
    if (sealed.outcome !== "accepted") throw new Error("fixture did not seal");
    const result = await service.checkpointExport({
      checkpointHash: sealed.checkpoint.checkpointHash,
      destination: "worm_compatible",
      idempotencyKey: "export-once",
      subject: seededSubject,
    });
    expect(result).toMatchObject({ duplicate: false, state: "exported" });
    const job = await repository.getAuditExportJob(
      seededSubject.orgId,
      result.jobId,
    );
    expect(job).toMatchObject({
      acknowledgementHash,
      attemptCount: 1,
      readbackHash: deliveredPayloadHash,
      status: "exported",
    });
    expect(
      await repository.listAuditExportAttempts(
        seededSubject.orgId,
        result.jobId,
      ),
    ).toHaveLength(1);
    expect(
      await service.checkpointExport({
        checkpointHash: sealed.checkpoint.checkpointHash,
        destination: "worm_compatible",
        idempotencyKey: "export-once",
        subject: seededSubject,
      }),
    ).toMatchObject({
      duplicate: true,
      jobId: result.jobId,
      state: "exported",
    });
  });

  it.each([
    ["destination_range_mismatch", "range"],
    ["readback_mismatch", "readback"],
    ["retention_lock_missing", "retention"],
  ] as const)(
    "dead-letters fail-closed export: %s",
    async (errorCode, mode) => {
      const repository = new InMemoryRomeoRepository();
      await seedAudits(repository);
      let payloadHash = "";
      const acknowledgementHash = sha256("ack-1");
      const client: AuditExportClient = {
        deliver: async ({ job, payload }) => {
          payloadHash = sha256(payload);
          return {
            acknowledgementHash,
            destinationRangeEnd:
              mode === "range"
                ? String(job.toSequence + 1)
                : String(job.toSequence),
            destinationRangeStart: String(job.fromSequence),
          };
        },
        readback: async ({ job }) => ({
          acknowledgementHash,
          checkpointHash: job.checkpointHash,
          destinationRangeEnd: String(job.toSequence),
          destinationRangeStart: String(job.fromSequence),
          payloadHash: mode === "readback" ? "0".repeat(64) : payloadHash,
          ...(mode === "retention" ? {} : { retentionLockEvidence: "locked" }),
        }),
      };
      const service = new AuditIntegrityService(repository, signer(), client, {
        exportMaxAttempts: 1,
      });
      const sealed = await service.seal({ subject: seededSubject });
      if (sealed.outcome !== "accepted")
        throw new Error("fixture did not seal");
      const result = await service.checkpointExport({
        destination: "worm_compatible",
        idempotencyKey: `export-${mode}`,
        subject: seededSubject,
      });
      expect(result.state).toBe("dead_letter");
      expect(
        await repository.getAuditExportJob(seededSubject.orgId, result.jobId),
      ).toMatchObject({ deadLetterReason: errorCode, status: "dead_letter" });
    },
  );

  it("requires contiguous verified partial batches before retention", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedAudits(repository);
    let payloadHash = "";
    const client: AuditExportClient = {
      deliver: async ({ job, payload }) => {
        payloadHash = sha256(payload);
        return {
          acknowledgementHash: sha256(`ack-${job.id}`),
          destinationRangeEnd: String(job.toSequence),
          destinationRangeStart: String(job.fromSequence),
        };
      },
      readback: async ({ acknowledgementHash, job }) => ({
        acknowledgementHash,
        checkpointHash: job.checkpointHash,
        destinationRangeEnd: String(job.toSequence),
        destinationRangeStart: String(job.fromSequence),
        payloadHash,
      }),
    };
    const service = serviceFor(repository, client);
    const first = await service.seal({
      maxRecords: 1,
      subject: seededSubject,
    });
    const second = await service.seal({ subject: seededSubject });
    if (first.outcome !== "accepted" || second.outcome !== "accepted")
      throw new Error("fixture did not seal");
    await service.checkpointExport({
      checkpointHash: second.checkpoint.checkpointHash,
      destination: "customer_siem",
      idempotencyKey: "partial-tail",
      subject: seededSubject,
    });
    expect(
      await repository.auditRetentionExportGate(
        seededSubject.orgId,
        "2027-01-01T00:00:00.000Z",
      ),
    ).toMatchObject({ deletable: false, requiredThroughSequence: 3 });
    await service.checkpointExport({
      checkpointHash: first.checkpoint.checkpointHash,
      destination: "customer_siem",
      idempotencyKey: "partial-head",
      subject: seededSubject,
    });
    expect(
      await repository.auditRetentionExportGate(
        seededSubject.orgId,
        "2027-01-01T00:00:00.000Z",
      ),
    ).toMatchObject({ deletable: true, requiredThroughSequence: 3 });
  });

  it("retries with a bounded schedule and blocks retention until readback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
    const repository = new InMemoryRomeoRepository();
    await seedAudits(repository);
    let calls = 0;
    let payloadHash = "";
    const acknowledgementHash = sha256("ack-retry");
    const client: AuditExportClient = {
      deliver: async ({ job, payload }) => {
        calls += 1;
        payloadHash = sha256(payload);
        if (calls === 1) throw new Error("private destination details");
        return {
          acknowledgementHash,
          destinationRangeEnd: String(job.toSequence),
          destinationRangeStart: String(job.fromSequence),
        };
      },
      readback: async ({ job }) => ({
        acknowledgementHash,
        checkpointHash: job.checkpointHash,
        destinationRangeEnd: String(job.toSequence),
        destinationRangeStart: String(job.fromSequence),
        payloadHash,
      }),
    };
    const service = new AuditIntegrityService(repository, signer(), client, {
      exportMaxAttempts: 2,
    });
    const sealed = await service.seal({ subject: seededSubject });
    if (sealed.outcome !== "accepted") throw new Error("fixture did not seal");
    const first = await service.checkpointExport({
      destination: "customer_siem",
      idempotencyKey: "retry-job",
      subject: seededSubject,
    });
    expect(first.state).toBe("failed");
    expect(
      await repository.auditRetentionExportGate(
        seededSubject.orgId,
        "2027-01-01T00:00:00.000Z",
      ),
    ).toMatchObject({ deletable: false });
    vi.advanceTimersByTime(1_001);
    expect(
      await service.processExportJob({
        jobId: first.jobId,
        orgId: seededSubject.orgId,
      }),
    ).toMatchObject({ attemptCount: 2, status: "exported" });
    expect(
      await repository.auditRetentionExportGate(
        seededSubject.orgId,
        "2027-01-01T00:00:00.000Z",
      ),
    ).toMatchObject({ deletable: true });
  });

  it("fails closed on destination timeouts and redacts delivery errors", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedAudits(repository);
    const client: AuditExportClient = {
      deliver: () => new Promise(() => undefined),
      readback: async () => {
        throw new Error("readback must not run after a timeout");
      },
    };
    const service = new AuditIntegrityService(repository, signer(), client, {
      exportAttemptTimeoutMs: 1,
      exportMaxAttempts: 1,
    });
    const sealed = await service.seal({ subject: seededSubject });
    if (sealed.outcome !== "accepted") throw new Error("fixture did not seal");
    const result = await service.checkpointExport({
      checkpointHash: sealed.checkpoint.checkpointHash,
      destination: "customer_siem",
      idempotencyKey: "timeout-job",
      subject: seededSubject,
    });
    expect(result.state).toBe("dead_letter");
    expect(
      await repository.getAuditExportJob(seededSubject.orgId, result.jobId),
    ).toMatchObject({
      deadLetterReason: "destination_timeout",
      lastErrorCode: "destination_timeout",
    });
  });

  it("rejects idempotency-key replay against a different stored checkpoint", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedAudits(repository);
    const service = serviceFor(repository);
    const first = await service.seal({ subject: seededSubject });
    if (first.outcome !== "accepted") throw new Error("fixture did not seal");
    await service.checkpointExport({
      checkpointHash: first.checkpoint.checkpointHash,
      destination: "customer_siem",
      idempotencyKey: "replay-key",
      subject: seededSubject,
    });
    await repository.createAuditLog({
      action: "local_auth.login",
      actorId: seededSubject.id,
      createdAt: "2026-08-23T12:04:00.000Z",
      id: "audit_integrity_4",
      metadata: {},
      orgId: seededSubject.orgId,
      outcome: "success",
      resourceId: "session_4",
      resourceType: "session",
    });
    const second = await service.seal({ subject: seededSubject });
    if (second.outcome !== "accepted") throw new Error("fixture did not seal");
    await expect(
      service.checkpointExport({
        checkpointHash: second.checkpoint.checkpointHash,
        destination: "customer_siem",
        idempotencyKey: "replay-key",
        subject: seededSubject,
      }),
    ).rejects.toMatchObject({ code: "idempotency_key_conflict", status: 409 });
  });

  it("keeps large inline audit exports on the async path", () => {
    expect(
      authorizeAuditExportJob({ estimatedRows: 201, mode: "inline" }),
    ).toEqual({
      code: "audit_export_must_be_async",
      outcome: "denied",
    });
  });
});

function serviceFor(
  repository: InMemoryRomeoRepository,
  client?: AuditExportClient,
) {
  return new AuditIntegrityService(repository, signer(), client);
}

function signer() {
  return new VersionedHmacAuditCheckpointSigner({
    activeKeyVersion: "audit-key.2026-08",
    keys: { "audit-key.2026-08": newKey },
  });
}

async function seedAudits(repository: InMemoryRomeoRepository) {
  for (let index = 1; index <= 3; index += 1) {
    await repository.createAuditLog({
      action: "local_auth.login",
      actorId: seededSubject.id,
      createdAt: `2026-08-23T12:0${index}:00.000Z`,
      id: `audit_integrity_${index}`,
      metadata: {},
      orgId: seededSubject.orgId,
      outcome: "success",
      resourceId: `session_${index}`,
      resourceType: "session",
    });
  }
}

function replace<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item));
}
