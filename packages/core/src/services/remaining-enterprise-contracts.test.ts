import { describe, expect, it } from "vitest";

import { authorizeCompareSynthesis, promoteCompareEvalCase, summarizeCompareCost } from "./compare-synthesis";
import {
  authorizeImageAdapter,
  authorizeImageArtifactGovernance,
  authorizeImageProcessing,
  describeAccessibleImageEdit,
  projectImageJobToChatPart,
} from "./image-adapter-governance";
import {
  evaluateAclFreshness,
  invalidateAclCaches,
  knowledgeAclCacheKey,
  planKnowledgeTombstone,
  summarizeAclMonitoring,
} from "./knowledge-acl-lifecycle";
import {
  authorizeVadInterruption,
  meterRealtimeUsage,
  negotiateRealtimeQuality,
  pauseRealtimeForToolApproval,
  scanCommittedTranscriptWindow,
  selectRealtimeAdapter,
} from "./realtime-voice-contracts";
import {
  assertRestoreIsolation,
  authorizeByokIntegration,
  authorizeCryptoShred,
  decideSearchVectorStrategy,
  planTenantKeyRotation,
} from "./tenant-crypto-lifecycle";

describe("remaining enterprise source contracts", () => {
  it("selects realtime adapters, barge-in, DLP, tool pause, quality, and usage", () => {
    expect(
      selectRealtimeAdapter({ nativeAvailable: false, pipelineAvailable: true }),
    ).toEqual({ outcome: "accepted", adapter: "pipeline" });
    expect(
      authorizeVadInterruption({
        mode: "server",
        sensitivity: 0.4,
        bargeIn: true,
        rawAudioRetained: false,
      }).outcome,
    ).toBe("accepted");
    expect(
      scanCommittedTranscriptWindow({
        committed: "sk-abcdefghijklmnopqrstuvwxyz123456",
        highSecurity: false,
        policyCleared: true,
      }).outcome,
    ).toBe("block");
    expect(
      pauseRealtimeForToolApproval({
        approvalRequired: true,
        voiceConfirmed: true,
      }),
    ).toEqual({
      outcome: "denied",
      code: "content_policy_approval_required",
    });
    expect(negotiateRealtimeQuality({
      noiseSuppression: true,
      echoCancellation: true,
      sampleRateHz: 12_000,
      captions: true,
    }).sampleRateHz).toBe(16_000);
    expect(
      meterRealtimeUsage({
        inputSeconds: 3,
        outputSeconds: 2,
        sttSeconds: 3,
        ttsSeconds: 2,
        interruptedSeconds: 1,
        modelMicroUsd: 40,
      }).interruptionWasteSeconds,
    ).toBe(1);
  });

  it("governs image adapters, processing, accessible edit, chat parts, and shred", () => {
    expect(
      authorizeImageAdapter({
        kind: "comfyui",
        egressAllowed: true,
        workflowAllowlisted: false,
      }).outcome,
    ).toBe("denied");
    expect(
      authorizeImageProcessing({
        pixels: 10,
        frames: 1,
        memoryBytes: 10,
        metadataStripped: true,
        malwareClean: true,
        watermarkRequired: false,
        watermarkApplied: false,
      }).outcome,
    ).toBe("accepted");
    expect(
      describeAccessibleImageEdit({
        hasPointer: false,
        maskUploaded: false,
        crop: true,
        rotateDegrees: -90,
      }).keyboardMaskPath,
    ).toBe(true);
    const part = projectImageJobToChatPart({
      fileId: "file_out",
      prompt: "a lake",
      modelId: "img_1",
      costMicroUsd: 12,
    });
    expect(part.outcome).toBe("accepted");
    if (part.outcome === "accepted")
      expect(part.part.type).toBe("image_ref");
    expect(
      authorizeImageArtifactGovernance({
        legalHold: true,
        retentionAllowsDelete: true,
        dlpBlocked: false,
        accessAuthorized: true,
      }).outcome,
    ).toBe("denied");
  });

  it("authorizes synthesis, redacted promotion, and compare cost caps", () => {
    expect(
      authorizeCompareSynthesis({
        candidateIds: ["c1"],
        candidateHashes: ["h1"],
        providerAuthorized: false,
        policyChecked: true,
      }).outcome,
    ).toBe("denied");
    expect(
      promoteCompareEvalCase({
        authorized: true,
        prompt: "q",
        preference: "a",
        retainAllCandidates: true,
      }).outcome,
    ).toBe("denied");
    expect(
      summarizeCompareCost({
        estimatedMicroUsd: 50,
        policyCapMicroUsd: 40,
        legs: [],
      }).outcome,
    ).toBe("denied");
  });

  it("versions ACL caches, fail-closes stale restricted sources, and plans tombstones", () => {
    const key = knowledgeAclCacheKey({
      subjectId: "user_1",
      groupVersion: "g1",
      grantVersion: "gr1",
      aclVersion: "a1",
    });
    expect(invalidateAclCaches({ revoked: true, caches: ["result", "citation"] })).toEqual([
      "result",
      "citation",
    ]);
    expect(key).toContain("user_1");
    expect(
      evaluateAclFreshness({
        sensitivity: "restricted",
        ageMs: 10,
        maxStalenessMs: 1,
      }),
    ).toMatchObject({ failClosed: true, code: "knowledge_acl_stale" });
    expect(
      planKnowledgeTombstone({
        legalHold: false,
        surfaces: ["primary", "vector", "keyword", "cache", "snippet", "summary", "retrieval"],
      }).outcome,
    ).toBe("accepted");
    expect(
      summarizeAclMonitoring({
        syncLagMs: 3,
        unresolvedPrincipals: 1,
        staleSources: 0,
        deletionBacklog: 0,
        deniedRetrieval: 2,
        externalFilterConforming: true,
      }).syntheticProbe,
    ).toBe(false);
  });

  it("requires workload-identity BYOK, dual-control rotation, and restore isolation", () => {
    expect(
      authorizeByokIntegration({
        provider: "aws_kms",
        workloadIdentity: false,
        staticCloudKey: true,
      }).outcome,
    ).toBe("denied");
    expect(
      planTenantKeyRotation({
        dualControl: true,
        bulkPlaintext: false,
        currentVersion: 3,
      }),
    ).toMatchObject({ outcome: "accepted", nextVersion: 4 });
    expect(
      authorizeCryptoShred({
        legalHold: false,
        backupChecked: true,
        approverIds: ["user_reviewer"],
        actorId: "user_admin",
      }).outcome,
    ).toBe("accepted");
    expect(decideSearchVectorStrategy({ dataClass: "restricted", customerHeldKey: true })).toEqual({
      mode: "disabled",
    });
    expect(
      assertRestoreIsolation({
        tenantIsolated: true,
        revokedKeyHonored: true,
        auditChainIntact: true,
        deletionStatePreserved: true,
      }).outcome,
    ).toBe("accepted");
  });
});
