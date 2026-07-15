import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readEnv } from "@romeo/config";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

describe("audit integrity posture API", () => {
  it("reports not configured without exposing evidence paths", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());

    const response = await api.request("/api/v1/admin/audit-integrity/posture");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      schema: "romeo.audit-integrity-posture.v1",
      status: "attention_required",
      evidence: {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        failureCodes: [],
      },
      warnings: ["audit_integrity_evidence_not_configured"],
    });
    expect(body.data.checks.missingRequired).toContain(
      "audit_export_configured",
    );
    expect(body.data.redaction.evidenceFileBodyReturned).toBe(false);
  });

  it("reports sanitized ready posture for reviewed audit integrity evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "romeo-audit-integrity-"));
    const evidencePath = join(directory, "audit-integrity-evidence.json");
    const rawSentinels = [
      "RAW_AUDIT_ACTOR_SENTINEL",
      "RAW_AUDIT_METADATA_SENTINEL",
      "https://siem.internal.example/collector?token=RAW_SIEM_TOKEN",
      "RAW_SIEM_PAYLOAD_SENTINEL",
    ];
    writeFileSync(
      evidencePath,
      JSON.stringify({
        schemaVersion: "romeo.audit-integrity-evidence.v1",
        generatedAt: "2026-07-07T03:30:00.000Z",
        status: "passed",
        mode: "live",
        deployment: "kubernetes",
        checks: [
          "audit_export_configured",
          "siem_delivery_readback",
          "immutable_storage_reviewed",
          "retention_policy_reviewed",
          "time_sync_reviewed",
          "checksum_chain_verified",
          "audit_evidence_redaction_flags",
        ],
        export: {
          enabled: true,
          destinationType: "siem",
          successfulDeliveryCount: 12,
          failedDeliveryCount: 0,
          lastDeliveryStatus: "passed",
          rawDestination: rawSentinels[2],
          rawPayload: rawSentinels[3],
        },
        immutability: {
          wormStorageConfigured: true,
          retentionLockConfigured: true,
          immutableWindowDays: 30,
          deleteProtectionReviewed: true,
        },
        retention: {
          auditLogRetentionDays: 365,
          exportRetentionDays: 730,
          policyReviewed: true,
        },
        timeSync: {
          sourceConfigured: true,
          checkedHostCount: 5,
          maxClockSkewMs: 42,
          driftWithinThreshold: true,
        },
        checksumChain: {
          checked: true,
          status: "passed",
          verifiedRecordCount: 144,
          brokenLinkCount: 0,
          rawActorId: rawSentinels[0],
          rawMetadata: rawSentinels[1],
        },
        redaction: {
          rawAuditMetadataReturned: false,
          rawActorIdentifiersReturned: false,
          rawDestinationReturned: false,
          rawSiemPayloadsReturned: false,
          rawEvidencePathsReturned: false,
          secretValuesReturned: false,
        },
      }),
      "utf8",
    );
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        AUDIT_INTEGRITY_EVIDENCE_PATH: evidencePath,
      }),
    });

    const response = await api.request("/api/v1/admin/audit-integrity/posture");
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      schema: "romeo.audit-integrity-posture.v1",
      status: "ready",
      evidence: {
        configured: true,
        source: "configured_file",
        status: "satisfied",
        schemaVersion: "romeo.audit-integrity-evidence.v1",
        evidenceStatus: "passed",
        mode: "live",
        deployment: "kubernetes",
        failureCodes: [],
      },
      checks: {
        requiredPresent: 7,
        missingRequired: [],
      },
      export: {
        enabled: true,
        destinationType: "siem",
        successfulDeliveryCount: 12,
        failedDeliveryCount: 0,
        lastDeliveryStatus: "passed",
      },
      immutability: {
        wormStorageConfigured: true,
        retentionLockConfigured: true,
        immutableWindowDays: 30,
        deleteProtectionReviewed: true,
      },
      checksumChain: {
        checked: true,
        status: "passed",
        verifiedRecordCount: 144,
        brokenLinkCount: 0,
      },
      warnings: [],
    });
    expect(body.data.redaction.rawDestinationReturned).toBe(false);
    expect(body.data.redaction.rawSiemPayloadsReturned).toBe(false);
    expect(serialized).not.toContain(evidencePath);
    expect(serialized).not.toContain(directory);
    for (const sentinel of rawSentinels) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("fails posture when checksum chain evidence is missing", async () => {
    const directory = mkdtempSync(join(tmpdir(), "romeo-audit-integrity-bad-"));
    const evidencePath = join(directory, "audit-integrity-evidence.json");
    writeFileSync(
      evidencePath,
      JSON.stringify({
        schemaVersion: "romeo.audit-integrity-evidence.v1",
        status: "passed",
        mode: "live",
        deployment: "kubernetes",
        checks: [
          "audit_export_configured",
          "siem_delivery_readback",
          "immutable_storage_reviewed",
          "retention_policy_reviewed",
          "time_sync_reviewed",
          "audit_evidence_redaction_flags",
        ],
        export: {
          enabled: true,
          destinationType: "siem",
          successfulDeliveryCount: 1,
          failedDeliveryCount: 0,
          lastDeliveryStatus: "passed",
        },
        immutability: {
          wormStorageConfigured: true,
          retentionLockConfigured: true,
          immutableWindowDays: 30,
          deleteProtectionReviewed: true,
        },
        retention: {
          auditLogRetentionDays: 365,
          exportRetentionDays: 365,
          policyReviewed: true,
        },
        timeSync: {
          sourceConfigured: true,
          checkedHostCount: 1,
          maxClockSkewMs: 100,
          driftWithinThreshold: true,
        },
        checksumChain: {
          checked: false,
          status: "unknown",
          verifiedRecordCount: 0,
          brokenLinkCount: 0,
        },
        redaction: {
          rawAuditMetadataReturned: false,
          rawActorIdentifiersReturned: false,
          rawDestinationReturned: false,
          rawSiemPayloadsReturned: false,
          rawEvidencePathsReturned: false,
          secretValuesReturned: false,
        },
      }),
      "utf8",
    );
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        AUDIT_INTEGRITY_EVIDENCE_PATH: evidencePath,
      }),
    });

    const response = await api.request("/api/v1/admin/audit-integrity/posture");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("attention_required");
    expect(body.data.evidence.status).toBe("failed");
    expect(body.data.evidence.failureCodes).toEqual([
      "audit_integrity_missing_check:checksum_chain_verified",
      "audit_integrity_checksum_chain_missing",
    ]);
    expect(body.data.warnings).toContain("audit_integrity_chain_missing");
  });

  it("reports GA-aligned failure codes for invalid audit integrity evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "romeo-audit-integrity-ga-"));
    const baseEvidence = {
      schemaVersion: "romeo.audit-integrity-evidence.v1",
      generatedAt: "2026-07-07T04:30:00.000Z",
      status: "passed",
      mode: "live",
      deployment: "kubernetes",
      checks: [
        "audit_export_configured",
        "siem_delivery_readback",
        "immutable_storage_reviewed",
        "retention_policy_reviewed",
        "time_sync_reviewed",
        "checksum_chain_verified",
        "audit_evidence_redaction_flags",
      ],
      export: {
        enabled: true,
        destinationType: "siem",
        successfulDeliveryCount: 2,
        failedDeliveryCount: 0,
        lastDeliveryStatus: "passed",
      },
      immutability: {
        wormStorageConfigured: true,
        retentionLockConfigured: true,
        immutableWindowDays: 30,
        deleteProtectionReviewed: true,
      },
      retention: {
        auditLogRetentionDays: 365,
        exportRetentionDays: 730,
        policyReviewed: true,
      },
      timeSync: {
        sourceConfigured: true,
        checkedHostCount: 3,
        maxClockSkewMs: 100,
        driftWithinThreshold: true,
      },
      checksumChain: {
        checked: true,
        status: "passed",
        verifiedRecordCount: 25,
        brokenLinkCount: 0,
      },
      failures: [],
      redaction: {
        rawAuditMetadataReturned: false,
        rawActorIdentifiersReturned: false,
        rawDestinationReturned: false,
        rawSiemPayloadsReturned: false,
        rawEvidencePathsReturned: false,
        secretValuesReturned: false,
      },
    };
    const cases = [
      {
        evidence: { ...baseEvidence, deployment: "unknown" },
        failureCode: "audit_integrity_deployment_invalid",
        warning: "audit_integrity_deployment_invalid",
      },
      {
        evidence: {
          ...baseEvidence,
          export: {
            ...baseEvidence.export,
            successfulDeliveryCount: 0,
          },
        },
        failureCode: "audit_integrity_delivery_missing",
        warning: "audit_integrity_delivery_missing",
      },
      {
        evidence: {
          ...baseEvidence,
          failures: ["raw_customer_siem_target"],
        },
        failureCode: "audit_integrity_failure_codes_present",
        warning: "audit_integrity_failure_codes_present",
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const evidencePath = join(directory, `audit-integrity-${index}.json`);
      writeFileSync(evidencePath, JSON.stringify(testCase.evidence), "utf8");
      const api = createRomeoApi(new InMemoryRomeoRepository(), {
        env: readEnv({
          AUDIT_INTEGRITY_EVIDENCE_PATH: evidencePath,
        }),
      });

      const response = await api.request(
        "/api/v1/admin/audit-integrity/posture",
      );
      const body = await response.json();
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(200);
      expect(body.data.status).toBe("attention_required");
      expect(body.data.evidence.status).toBe("failed");
      expect(body.data.evidence.failureCodes).toContain(testCase.failureCode);
      expect(body.data.warnings).toContain(testCase.warning);
      expect(serialized).not.toContain("raw_customer_siem_target");
    }
  });
});
