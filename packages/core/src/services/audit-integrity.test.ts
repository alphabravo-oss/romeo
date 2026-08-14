import { describe, expect, it } from "vitest";

import {
  authorizeAuditExportJob,
  checkpointSiemExport,
  sealAuditSegment,
  verifyAuditSegment,
} from "./audit-integrity";

describe("audit integrity", () => {
  it("seals hash-chained segments and verifies the previous hash", () => {
    const first = sealAuditSegment({
      eventIds: ["audit_1", "audit_2"],
      now: "2026-08-14T12:00:00.000Z",
      signingKeyVersion: "audit-signing.v1",
    });
    expect(first.outcome).toBe("accepted");
    if (first.outcome !== "accepted") return;
    expect(first.segment.previousHash).toBe("genesis");
    expect(first.segment.eventCount).toBe(2);
    expect(
      verifyAuditSegment({ segment: first.segment }).outcome,
    ).toBe("accepted");
    expect(
      verifyAuditSegment({
        previousHash: "tampered",
        segment: first.segment,
      }),
    ).toEqual({ code: "audit_segment_chain_broken", outcome: "denied" });
    expect(
      sealAuditSegment({
        eventIds: [],
        now: "2026-08-14T12:00:00.000Z",
        signingKeyVersion: "audit-signing.v1",
      }),
    ).toEqual({ code: "audit_segment_empty", outcome: "denied" });
  });

  it("checkpoints SIEM/WORM export with retry, lag, and duplicate receipts", () => {
    const first = checkpointSiemExport({
      attempt: 0,
      destination: "worm_compatible",
      now: "2026-08-14T12:01:00.000Z",
      sealedAt: "2026-08-14T12:00:00.000Z",
      segmentHash: "abc",
    });
    expect(first).toMatchObject({
      lagMs: 60_000,
      state: "in_flight",
    });
    expect(
      checkpointSiemExport({
        attempt: 1,
        destination: "customer_siem",
        now: "2026-08-14T12:02:00.000Z",
        receiptHash: "recv_1",
        sealedAt: "2026-08-14T12:00:00.000Z",
        segmentHash: "abc",
      }).state,
    ).toBe("exported");
    expect(
      checkpointSiemExport({
        attempt: 2,
        destination: "customer_siem",
        now: "2026-08-14T12:03:00.000Z",
        priorReceiptHash: "recv_1",
        receiptHash: "recv_1",
        sealedAt: "2026-08-14T12:00:00.000Z",
        segmentHash: "abc",
      }).state,
    ).toBe("duplicate");
    expect(
      authorizeAuditExportJob({ estimatedRows: 201, mode: "inline" }),
    ).toEqual({ code: "audit_export_must_be_async", outcome: "denied" });
    expect(
      authorizeAuditExportJob({ estimatedRows: 201, mode: "async_job" }),
    ).toEqual({ mode: "async_job", outcome: "accepted" });
  });
});
