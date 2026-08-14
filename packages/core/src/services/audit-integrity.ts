import { createHash } from "node:crypto";

export const AUDIT_SEGMENT_SCHEMA = "romeo.audit-segment.v1";
export const SIEM_CHECKPOINT_SCHEMA = "romeo.audit-siem-checkpoint.v1";

export type SiemDestination = "customer_siem" | "worm_compatible";
export type SiemExportState =
  | "duplicate"
  | "exported"
  | "failed"
  | "in_flight"
  | "pending";

export interface AuditSegment {
  eventCount: number;
  exportState: SiemExportState;
  firstEventId: string;
  lastEventId: string;
  previousHash: string;
  schema: typeof AUDIT_SEGMENT_SCHEMA;
  sealedAt: string;
  segmentHash: string;
  signingKeyVersion: string;
}

export interface SiemExportCheckpoint {
  attempt: number;
  destination: SiemDestination;
  lagMs: number;
  receiptHash?: string;
  schema: typeof SIEM_CHECKPOINT_SCHEMA;
  segmentHash: string;
  state: SiemExportState;
}

export function sealAuditSegment(input: {
  eventIds: readonly string[];
  now: string;
  previousHash?: string;
  signingKeyVersion: string;
}):
  | { outcome: "denied"; code: "audit_segment_empty" }
  | { outcome: "accepted"; segment: AuditSegment } {
  if (input.eventIds.length === 0)
    return { outcome: "denied", code: "audit_segment_empty" };
  const previousHash = input.previousHash ?? "genesis";
  const firstEventId = input.eventIds[0]!;
  const lastEventId = input.eventIds[input.eventIds.length - 1]!;
  const segmentHash = createHash("sha256")
    .update(
      `${AUDIT_SEGMENT_SCHEMA}\n${previousHash}\n${input.signingKeyVersion}\n${input.eventIds.join(",")}\n${input.now}`,
    )
    .digest("hex");
  return {
    outcome: "accepted",
    segment: {
      eventCount: input.eventIds.length,
      exportState: "pending",
      firstEventId,
      lastEventId,
      previousHash,
      schema: AUDIT_SEGMENT_SCHEMA,
      sealedAt: input.now,
      segmentHash,
      signingKeyVersion: input.signingKeyVersion,
    },
  };
}

export function verifyAuditSegment(input: {
  previousHash?: string;
  segment: AuditSegment;
}):
  | { outcome: "accepted" }
  | { outcome: "denied"; code: "audit_segment_chain_broken" } {
  const expected = input.previousHash ?? "genesis";
  if (input.segment.previousHash !== expected)
    return { outcome: "denied", code: "audit_segment_chain_broken" };
  if (input.segment.schema !== AUDIT_SEGMENT_SCHEMA)
    return { outcome: "denied", code: "audit_segment_chain_broken" };
  return { outcome: "accepted" };
}

export function checkpointSiemExport(input: {
  attempt: number;
  destination: SiemDestination;
  now: string;
  priorReceiptHash?: string;
  receiptHash?: string;
  sealedAt: string;
  segmentHash: string;
}): SiemExportCheckpoint {
  const lagMs = Math.max(0, Date.parse(input.now) - Date.parse(input.sealedAt));
  if (
    input.priorReceiptHash !== undefined &&
    input.receiptHash !== undefined &&
    input.priorReceiptHash === input.receiptHash
  ) {
    return {
      attempt: input.attempt,
      destination: input.destination,
      lagMs,
      receiptHash: input.receiptHash,
      schema: SIEM_CHECKPOINT_SCHEMA,
      segmentHash: input.segmentHash,
      state: "duplicate",
    };
  }
  if (input.receiptHash !== undefined) {
    return {
      attempt: input.attempt,
      destination: input.destination,
      lagMs,
      receiptHash: input.receiptHash,
      schema: SIEM_CHECKPOINT_SCHEMA,
      segmentHash: input.segmentHash,
      state: "exported",
    };
  }
  return {
    attempt: input.attempt,
    destination: input.destination,
    lagMs,
    schema: SIEM_CHECKPOINT_SCHEMA,
    segmentHash: input.segmentHash,
    state: input.attempt > 0 ? "failed" : "in_flight",
  };
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
