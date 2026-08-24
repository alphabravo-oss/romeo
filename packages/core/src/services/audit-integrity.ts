import { assertScope, type AuthSubject } from "@romeo/auth";

import {
  AUDIT_EXPORT_GENESIS_HASH,
  AUDIT_INTEGRITY_CHECKPOINT_SCHEMA,
  canonicalJson,
  sha256,
  verifyAuditIntegrityRecord,
  type AuditExportDestinationKind,
  type AuditIntegrityCheckpoint,
  type AuditIntegrityRecord,
} from "../domain/audit-integrity";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import type { AuditCheckpointSigner } from "./audit-checkpoint-signer";
import {
  AuditExportWorkflow,
  type AuditExportClient,
  type AuditExportWorkflowOptions,
} from "./audit-export-workflow";

export {
  type AuditCheckpointSigner,
  VersionedHmacAuditCheckpointSigner,
} from "./audit-checkpoint-signer";
export type {
  AuditDestinationPosture,
  AuditExportClient,
  AuditExportDelivery,
  AuditExportReadback,
} from "./audit-export-workflow";

export type AuditCheckpointVerificationCode =
  | "checkpoint_chain_broken"
  | "checkpoint_hash_mismatch"
  | "checkpoint_range_mismatch"
  | "checkpoint_root_mismatch"
  | "checkpoint_signature_invalid"
  | "checkpoint_unknown_key_version"
  | "cross_tenant_record"
  | "record_chain_broken"
  | "record_content_modified"
  | "record_count_mismatch"
  | "record_order_modified";

export interface AuditCheckpointVerification {
  code?: AuditCheckpointVerificationCode;
  outcome: "accepted" | "denied";
}

export class AuditIntegrityService {
  private readonly exportWorkflow: AuditExportWorkflow;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly signer: AuditCheckpointSigner,
    exportClient?: AuditExportClient,
    options: AuditExportWorkflowOptions = {},
  ) {
    this.exportWorkflow = new AuditExportWorkflow(
      repository,
      (checkpoint) => this.verifyCheckpoint({ checkpoint }),
      exportClient,
      options,
    );
  }

  async seal(input: {
    maxRecords?: number;
    subject: AuthSubject;
  }): Promise<
    | { code: "audit_segment_empty"; outcome: "denied" }
    | { checkpoint: AuditIntegrityCheckpoint; outcome: "accepted" }
  > {
    assertScope(input.subject, "admin:write");
    await this.repository.ensureAuditIntegrityRecords(input.subject.orgId);
    const records = await this.repository.listAuditIntegrityRecords(
      input.subject.orgId,
    );
    const checkpoints = await this.repository.listAuditIntegrityCheckpoints(
      input.subject.orgId,
    );
    const previousCheckpoint = checkpoints.at(-1);
    if (
      previousCheckpoint !== undefined &&
      !(await this.verifyCheckpointSignature(previousCheckpoint))
    )
      throw new Error("audit_integrity_checkpoint_chain_invalid");
    const startSequence =
      previousCheckpoint === undefined
        ? (records[0]?.sequence ?? 1)
        : previousCheckpoint.toSequence + 1;
    const selected = records
      .filter((record) => record.sequence >= startSequence)
      .slice(0, Math.min(Math.max(input.maxRecords ?? 500, 1), 500));
    if (selected.length === 0)
      return { code: "audit_segment_empty", outcome: "denied" };
    const preceding = records.find(
      (record) => record.sequence === startSequence - 1,
    );
    if (
      !verifyRecordRange(selected, {
        expectedFirstSequence: startSequence,
        expectedPreviousHash:
          preceding?.recordHash ??
          previousCheckpoint?.lastRecordHash ??
          selected[0]?.previousHash ??
          AUDIT_EXPORT_GENESIS_HASH,
        orgId: input.subject.orgId,
      })
    )
      throw new Error("audit_integrity_chain_invalid");
    const now = new Date().toISOString();
    const first = selected[0]!;
    const last = selected.at(-1)!;
    const unsigned = {
      algorithm: this.signer.activeAlgorithm,
      createdAt: now,
      firstRecordHash: first.recordHash,
      fromSequence: first.sequence,
      keyVersion: this.signer.activeKeyVersion,
      lastRecordHash: last.recordHash,
      orgId: input.subject.orgId,
      previousCheckpointHash:
        previousCheckpoint?.checkpointHash ?? AUDIT_EXPORT_GENESIS_HASH,
      recordCount: selected.length,
      rootHash: merkleRoot(selected.map((record) => record.recordHash)),
      schema: AUDIT_INTEGRITY_CHECKPOINT_SCHEMA,
      toSequence: last.sequence,
    } as const;
    const signature = await this.signer.sign(canonicalJson(unsigned));
    const checkpoint: AuditIntegrityCheckpoint = {
      ...unsigned,
      checkpointHash: sha256(canonicalJson({ signature, signed: unsigned })),
      id: createId("audit_checkpoint"),
      signature,
    };
    return {
      checkpoint:
        await this.repository.createAuditIntegrityCheckpoint(checkpoint),
      outcome: "accepted",
    };
  }

  async verifyCheckpoint(input: {
    checkpoint: AuditIntegrityCheckpoint;
    records?: readonly AuditIntegrityRecord[];
  }): Promise<AuditCheckpointVerification> {
    const { checkpoint } = input;
    if (
      checkpoint.fromSequence < 1 ||
      checkpoint.toSequence < checkpoint.fromSequence ||
      checkpoint.recordCount !==
        checkpoint.toSequence - checkpoint.fromSequence + 1
    )
      return denied("checkpoint_range_mismatch");
    const allRecords =
      input.records ??
      (await this.repository.listAuditIntegrityRecords(checkpoint.orgId));
    const tenantCheckpoints =
      await this.repository.listAuditIntegrityCheckpoints(checkpoint.orgId);
    const precedingCheckpoint = tenantCheckpoints.find(
      (candidate) => candidate.toSequence === checkpoint.fromSequence - 1,
    );
    if (
      checkpoint.previousCheckpointHash !==
      (precedingCheckpoint?.checkpointHash ?? AUDIT_EXPORT_GENESIS_HASH)
    )
      return denied("checkpoint_chain_broken");
    const records = allRecords.filter(
      (record) =>
        record.sequence >= checkpoint.fromSequence &&
        record.sequence <= checkpoint.toSequence,
    );
    if (records.length !== checkpoint.recordCount)
      return denied("record_count_mismatch");
    if (records.some((record) => record.orgId !== checkpoint.orgId))
      return denied("cross_tenant_record");
    const preceding = allRecords.find(
      (record) => record.sequence === checkpoint.fromSequence - 1,
    );
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      const expectedSequence = checkpoint.fromSequence + index;
      if (record.sequence !== expectedSequence)
        return denied("record_order_modified");
      const expectedPreviousHash =
        index === 0
          ? (preceding?.recordHash ??
            precedingCheckpoint?.lastRecordHash ??
            records[0]?.previousHash ??
            AUDIT_EXPORT_GENESIS_HASH)
          : records[index - 1]!.recordHash;
      if (record.previousHash !== expectedPreviousHash)
        return denied("record_chain_broken");
      if (
        !verifyAuditIntegrityRecord({
          expectedPreviousHash,
          expectedSequence,
          record,
        })
      )
        return denied("record_content_modified");
    }
    if (
      checkpoint.firstRecordHash !== records[0]!.recordHash ||
      checkpoint.lastRecordHash !== records.at(-1)!.recordHash ||
      checkpoint.rootHash !==
        merkleRoot(records.map((record) => record.recordHash))
    )
      return denied("checkpoint_root_mismatch");
    const unsigned = checkpointUnsigned(checkpoint);
    if (!(await this.signer.hasKeyVersion(checkpoint.keyVersion)))
      return denied("checkpoint_unknown_key_version");
    if (
      !(await this.signer.verify({
        algorithm: checkpoint.algorithm,
        keyVersion: checkpoint.keyVersion,
        payload: canonicalJson(unsigned),
        signature: checkpoint.signature,
      }))
    )
      return denied("checkpoint_signature_invalid");
    if (
      sha256(
        canonicalJson({ signature: checkpoint.signature, signed: unsigned }),
      ) !== checkpoint.checkpointHash
    )
      return denied("checkpoint_hash_mismatch");
    return { outcome: "accepted" };
  }

  checkpointExport(input: {
    checkpointHash?: string;
    destination: AuditExportDestinationKind;
    idempotencyKey: string;
    subject: AuthSubject;
  }) {
    return this.exportWorkflow.checkpoint(input);
  }

  processExportJob(input: { jobId: string; orgId: string }) {
    return this.exportWorkflow.process(input);
  }

  exportPosture(subject: AuthSubject) {
    return this.exportWorkflow.posture(subject);
  }

  private async verifyCheckpointSignature(
    checkpoint: AuditIntegrityCheckpoint,
  ) {
    const unsigned = checkpointUnsigned(checkpoint);
    return (
      (await this.signer.verify({
        algorithm: checkpoint.algorithm,
        keyVersion: checkpoint.keyVersion,
        payload: canonicalJson(unsigned),
        signature: checkpoint.signature,
      })) &&
      sha256(
        canonicalJson({ signature: checkpoint.signature, signed: unsigned }),
      ) === checkpoint.checkpointHash
    );
  }
}

function checkpointUnsigned(checkpoint: AuditIntegrityCheckpoint) {
  return {
    algorithm: checkpoint.algorithm,
    createdAt: checkpoint.createdAt,
    firstRecordHash: checkpoint.firstRecordHash,
    fromSequence: checkpoint.fromSequence,
    keyVersion: checkpoint.keyVersion,
    lastRecordHash: checkpoint.lastRecordHash,
    orgId: checkpoint.orgId,
    previousCheckpointHash: checkpoint.previousCheckpointHash,
    recordCount: checkpoint.recordCount,
    rootHash: checkpoint.rootHash,
    schema: checkpoint.schema,
    toSequence: checkpoint.toSequence,
  };
}

function verifyRecordRange(
  records: readonly AuditIntegrityRecord[],
  input: {
    expectedFirstSequence: number;
    expectedPreviousHash: string;
    orgId: string;
  },
) {
  let expectedPreviousHash = input.expectedPreviousHash;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.orgId !== input.orgId) return false;
    if (
      !verifyAuditIntegrityRecord({
        expectedPreviousHash,
        expectedSequence: input.expectedFirstSequence + index,
        record,
      })
    )
      return false;
    expectedPreviousHash = record.recordHash;
  }
  return true;
}

function merkleRoot(hashes: readonly string[]) {
  if (hashes.length === 0) return AUDIT_EXPORT_GENESIS_HASH;
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(sha256(`romeo.audit-merkle.v1\n${left}\n${right}`));
    }
    level = next;
  }
  return level[0]!;
}

function denied(code: AuditCheckpointVerificationCode) {
  return { code, outcome: "denied" as const };
}

export function authorizeAuditExportJob(input: {
  estimatedRows: number;
  mode: "async_job" | "inline";
}):
  | { outcome: "accepted"; mode: "async_job" | "inline" }
  | { outcome: "denied"; code: "audit_export_must_be_async" } {
  if (input.mode === "inline" && input.estimatedRows > 200)
    return { outcome: "denied", code: "audit_export_must_be_async" };
  return { outcome: "accepted", mode: input.mode };
}
