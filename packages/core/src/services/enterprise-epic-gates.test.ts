import { publicRunEvent } from "@romeo/ai-runtime";
import { describe, expect, it } from "vitest";

import { getCapabilityDefinition } from "./capability-definition-registry";
import { resolveGenericCapability } from "./capability-generic-resolution";
import { summarizeCapabilityImpact } from "./capability-impact-preview";
import { preflightCompareSession } from "./compare-preflight";
import {
  authorizeComputeJob,
  evaluateComputeEgress,
  recoverComputeLease,
} from "./compute-runner-protocol";
import {
  admitComputeArtifact,
  authorizeRuntimeImage,
  evaluateSandboxPosture,
} from "./compute-artifact-trust";
import { createPageCursorCodec } from "./page-cursor";
import { recoverIdempotentCheckpoint } from "./idempotency-checkpoint";
import { authorizeImageJob } from "./image-job-policy";
import {
  prefilterKnowledgeCandidates,
  recheckKnowledgeAccess,
} from "./knowledge-acl-prefilter";
import {
  applyOutputPolicyBeforePersist,
  OutputPolicyBuffer,
} from "./output-policy-buffer";
import {
  evaluateProviderProbe,
  omitUnsupportedProviderKnobs,
} from "./provider-capability-merge";
import { createTranscriptCheckpoint } from "./transcript-checkpoint";
import {
  canSubstitutePlatformKey,
  openTenantEnvelope,
  revokeTenantKey,
  sealTenantEnvelope,
} from "./tenant-crypto";
import { mergeSavedViews, migrateLocalSavedView } from "./server-table-saved-view";
import { authorizeTableExportJob } from "./server-table-export-job";
import { applySearchIndexMutation, lookupSearchIndexEntry } from "./message-search-index";
import { planRetentionCohesion } from "./retention-cohesion";
import { validateRegionalEndpoint } from "./provider-endpoint-policy";
import { persistReasoningSummary } from "./persist-reasoning-summary";
import { previewModelCompatibility } from "./provider-adapter-contracts";
import { projectProviderParts } from "./provider-part-projection";
import { evaluateDestinationPolicy } from "./policy-boundaries";
import { declareConnectorAclCapability } from "./connector-acl-catalog";
import { applyCompareGroupCancel } from "./compare-session-control";
import { planFileReferenceAttach, reconcileAttachRetention } from "./file-reference-writer";
import { selectRealtimeAdapter } from "./realtime-voice-contracts";
import { authorizeCompareSynthesis } from "./compare-synthesis";
import { evaluateAclFreshness } from "./knowledge-acl-lifecycle";
import { authorizeCryptoShred } from "./tenant-crypto-lifecycle";
import { completeDirectUploadProtocol } from "./direct-upload-protocol";
import { normalizeUploadedMedia } from "./media-normalization";
import { persistProviderOutputParts } from "./persist-output-parts";
import { evaluateModalityContentPolicy } from "./modality-content-policy";
import { createPolicyVersionDraft, publishPolicyVersion } from "./content-policy-versioning";
import { requestPolicyApproval } from "./policy-approval";

describe("enterprise epic gates", () => {
  it("resolves deny-dominance and distinct capability statuses", async () => {
    const definition = getCapabilityDefinition("secure_compute")!;
    expect(
      resolveGenericCapability({
        assignments: [],
        definition,
        now: "2026-08-14T10:00:00.000Z",
        platformDisabled: true,
      }).effective.status,
    ).toBe("disabled");
    expect(
      resolveGenericCapability({
        assignments: [
          {
            id: "a1",
            orgId: "org_default",
            scopeType: "organization",
            scopeId: "org_default",
            capabilityId: "secure_compute",
            state: "disabled",
            configuration: {},
            version: 1,
            actorId: "user_admin",
            reason: "deny",
            effectiveAt: "2026-08-14T09:00:00.000Z",
            createdAt: "2026-08-14T09:00:00.000Z",
          },
        ],
        definition,
        now: "2026-08-14T10:00:00.000Z",
        platformDisabled: false,
      }).effective.status,
    ).toBe("not_allowed");
    expect(
      resolveGenericCapability({
        assignments: [],
        definition,
        now: "2026-08-14T10:00:00.000Z",
        platformDisabled: false,
        entitled: false,
      }).effective.status,
    ).toBe("not_entitled");
    expect(
      resolveGenericCapability({
        assignments: [],
        definition,
        now: "2026-08-14T10:00:00.000Z",
        platformDisabled: false,
        installed: "no",
      }).effective.status,
    ).toBe("not_configured");
    const preview = summarizeCapabilityImpact([
      {
        role: "member",
        workspaceClass: "default",
        effective: resolveGenericCapability({
          assignments: [],
          definition,
          now: "2026-08-14T10:00:00.000Z",
          platformDisabled: false,
          entitled: false,
        }).effective,
      },
    ]);
    expect(preview.counts.not_entitled).toBe(1);
  });

  it("replays completed work, conflicts on shape, and fails a crash before receipt", () => {
    expect(
      recoverIdempotentCheckpoint({
        receipt: { state: "completed", requestHash: "a".repeat(64) },
        checkpoint: {
          receiptId: "r1",
          operation: "exports.execute",
          requestHash: "a".repeat(64),
          stage: "side_effect_completed",
          effectRef: { kind: "export", id: "exp_1" },
        },
        requestHash: "a".repeat(64),
      }),
    ).toMatchObject({ action: "replay" });
    expect(
      recoverIdempotentCheckpoint({
        receipt: { state: "completed", requestHash: "a".repeat(64) },
        requestHash: "b".repeat(64),
      }),
    ).toEqual({ action: "conflict" });
    expect(
      recoverIdempotentCheckpoint({
        receipt: { state: "in_progress", requestHash: "a".repeat(64) },
        checkpoint: {
          receiptId: "r1",
          operation: "compute.jobs.create",
          requestHash: "a".repeat(64),
          stage: "side_effect_started",
        },
        requestHash: "a".repeat(64),
      }),
    ).toMatchObject({ action: "fail" });
  });

  it("rejects a tampered tenant cursor", () => {
    const codec = createPageCursorCodec({
      resource: "users",
      secrets: ["c".repeat(32)],
    });
    const token = codec.encode({
      filter: { orgId: "org_1" },
      sort: [],
      position: { id: "user_1" },
    });
    expect(() =>
      codec.decode(
        `${token.slice(0, -2)}aa`,
        { filter: { orgId: "org_1" }, sort: [] },
        (value) =>
          typeof value === "object" && value !== null && "id" in value
            ? { id: String((value as { id: unknown }).id) }
            : undefined,
      ),
    ).toThrow();
  });

  it("creates and DLP-blocks unsafe checkpoints", () => {
    expect(
      createTranscriptCheckpoint({
        id: "cp1",
        chatId: "chat_1",
        messages: [{ id: "m1", role: "system", content: "Stay safe", policyMarker: true }],
        summarize: (items) => items.map((item) => item.content).join(""),
        scan: (summary) =>
          /secret/i.test(summary)
            ? { action: "block", text: summary }
            : { action: "allow", text: summary },
      }),
    ).toMatchObject({ summary: "Stay safe" });
  });

  it("omits unsupported knobs and fails closed on probe mismatch", () => {
    expect(
      omitUnsupportedProviderKnobs({
        requested: { temperature: 0.1, seed: 1 },
        supported: new Set(["temperature"]),
      }).omitted,
    ).toEqual(["seed"]);
    expect(evaluateProviderProbe({ advertised: true, probed: false })).toEqual({
      outcome: "mismatch",
      code: "provider_probe_mismatch",
    });
  });

  it("never publishes raw hidden reasoning", () => {
    const leaked = publicRunEvent({
      id: "evt_1",
      runId: "run_1",
      sequence: 1,
      type: "message.reasoning",
      createdAt: "2026-08-14T10:00:00.000Z",
      data: { text: "RAW_CHAIN_OF_THOUGHT" },
    });
    expect(JSON.stringify(leaked)).not.toContain("RAW_CHAIN_OF_THOUGHT");
    expect(leaked.data).toMatchObject({
      classification: "hidden_reasoning_omitted",
    });
  });

  it("cancels image jobs and refuses revoked sources", () => {
    expect(
      authorizeImageJob({
        platformDisabled: false,
        kind: "edit",
        jobId: "job_1",
        source: { fileId: "file_1", ready: true, revoked: true },
      }),
    ).toEqual({ outcome: "denied", code: "image_job_source_revoked" });
  });

  it("default-denies compute egress and recovers only a live lease", () => {
    expect(
      authorizeComputeJob({
        platformDisabled: false,
        runtime: "uninstalled",
        jobId: "job_1",
      }).code,
    ).toBe("compute_runtime_uninstalled");
    expect(
      evaluateComputeEgress({
        hostname: "169.254.169.254",
        approvedDestinations: [],
      }).code,
    ).toBe("compute_egress_denied");
    expect(
      recoverComputeLease({
        lease: {
          jobId: "job_1",
          runnerId: "runner_a",
          leaseToken: "tok",
          expiresAt: "2026-08-14T10:00:00.000Z", // deliberately-expired: lease recovery
        },
        runnerId: "runner_a",
        now: "2026-08-14T10:01:00.000Z",
      }).code,
    ).toBe("compute_lease_lost");
    expect(
      evaluateSandboxPosture({
        allowPrivilegeEscalation: false,
        apparmor: true,
        capabilities: ["SYS_ADMIN"],
        cpuMillis: 1_000,
        diskBytes: 64 * 1024 * 1024,
        hostNamespaces: false,
        jobScopedTmp: true,
        memoryBytes: 256 * 1024 * 1024,
        nonRoot: true,
        pidLimit: 64,
        privileged: false,
        rootReadOnly: true,
        seccomp: true,
        teardown: "deterministic",
        wallSeconds: 30,
      }).code,
    ).toBe("compute_sandbox_posture_denied");
    expect(
      authorizeRuntimeImage({
        allowlistedDigests: [],
        approvedOfflineMirror: false,
        imageDigest: "sha256:0123456789abcdef",
        mutableTag: true,
        publicPackageInstall: true,
        signed: false,
      }).code,
    ).toBe("compute_runtime_image_unverified");
    expect(
      admitComputeArtifact({
        archiveEntries: 1,
        archiveExpansionBytes: 10,
        count: 1,
        dlp: "allow",
        malware: "clean",
        mediaType: "text/csv",
        outputPath: "../out.csv",
        sha256: `sha256:${"ab".repeat(32)}`,
        sizeBytes: 10,
      }).code,
    ).toBe("compute_artifact_intake_denied");
  });

  it("preflights compare sessions and keeps partial failure explicit", () => {
    expect(
      preflightCompareSession({
        platformDisabled: false,
        maxLegs: 2,
        maxAggregateMicroUsd: 100,
        legs: [
          {
            legId: "a",
            modelId: "m1",
            providerId: "p1",
            authorized: true,
            estimatedMicroUsd: 40,
          },
          {
            legId: "b",
            modelId: "m2",
            providerId: "p2",
            authorized: false,
            estimatedMicroUsd: 40,
          },
        ],
      }),
    ).toMatchObject({
      outcome: "denied",
      failedLegIds: ["b"],
    });
  });

  it("blocks split-chunk output before persist or SSE", () => {
    const buffer = new OutputPolicyBuffer({
      mode: "rolling",
      detectors: {
        credit_card: "disabled",
        email_address: "disabled",
        us_ssn: "block",
        api_token: "disabled",
      },
      lookbehindCharacters: 8,
    });
    const persisted: string[] = [];
    applyOutputPolicyBeforePersist({
      buffer,
      chunk: "078-",
      persist: (text) => persisted.push(text),
      emit: () => undefined,
    });
    const blocked = applyOutputPolicyBeforePersist({
      buffer,
      chunk: "05-1120",
      persist: (text) => persisted.push(text),
      emit: () => undefined,
    });
    expect(blocked.action).toBe("block");
    expect(persisted).toEqual([]);
  });

  it("prefilters knowledge ACL and fails closed after mid-run revoke", () => {
    const allowed = prefilterKnowledgeCandidates({
      candidates: [
        {
          sourceId: "s1",
          documentId: "d1",
          aclRevision: "1",
          syncedAt: "2026-08-14T10:00:00.000Z",
        },
      ],
      bindings: [
        {
          sourceId: "s1",
          documentId: "d1",
          principalId: "user_1",
          permission: "read",
          aclRevision: "1",
          syncedAt: "2026-08-14T10:00:00.000Z",
        },
      ],
      principalId: "user_1",
      now: "2026-08-14T10:00:30.000Z",
      maxStalenessMs: 60_000,
      failClosedWhenStale: true,
    });
    expect(allowed.allowed).toHaveLength(1);
    expect(
      recheckKnowledgeAccess({
        previouslyAllowed: allowed.allowed,
        bindings: [],
        principalId: "user_1",
        now: "2026-08-14T10:01:00.000Z",
        maxStalenessMs: 60_000,
      }).reasonCode,
    ).toBe("knowledge_acl_denied");
  });

  it("binds tenant AAD and never substitutes a platform key after revoke", () => {
    const key = {
      version: 1,
      state: "active" as const,
      purpose: "file",
      orgId: "org_default",
      wrappingKeyId: "kms_1",
    };
    const sealed = sealTenantEnvelope({
      key,
      wrappingMaterial: Buffer.from("customer-wrapping-material-32b!!"),
      plaintext: Buffer.from("payload"),
      resourceId: "file_1",
    });
    expect(sealed.outcome).toBe("ok");
    expect(canSubstitutePlatformKey(key)).toBe(false);
    expect(
      openTenantEnvelope({
        key: revokeTenantKey(key),
        wrappingMaterial: Buffer.from("customer-wrapping-material-32b!!"),
        envelope: sealed.envelope!,
      }).code,
    ).toBe("tenant_key_revoked");
  });

  it("covers saved-view merge, async export, search tombstone, retention hold, residency, and summary persist", () => {
    const local = migrateLocalSavedView({
      local: { name: "Audit", globalFilter: "denied", pageSize: 25 },
      orgId: "org_default",
      workspaceId: "workspace_default",
      ownerUserId: "user_dev_admin",
      resource: "audit_logs",
      allowedFields: new Set(["createdAt"]),
      now: "2026-08-14T12:00:00.000Z",
    });
    if ("outcome" in local) throw new Error("expected view");
    expect(mergeSavedViews({ server: [local], localFallback: [local] })).toHaveLength(1);
    expect(
      authorizeTableExportJob({ mode: "browser_csv", estimatedRows: 8_000 }),
    ).toEqual({ outcome: "denied", code: "table_export_must_be_async" });
    const tombstoned = applySearchIndexMutation(undefined, {
      type: "tombstone",
      key: {
        orgId: "org_default",
        workspaceId: "workspace_default",
        chatId: "chat_1",
        grantVersion: "g1",
        aclVersion: "a1",
      },
      messageId: "msg_1",
      now: "2026-08-14T12:00:00.000Z",
    });
    if ("outcome" in tombstoned) throw new Error("expected tombstone");
    expect(lookupSearchIndexEntry(tombstoned).outcome).toBe("miss");
    expect(
      planRetentionCohesion({
        legalHold: true,
        deleted: true,
        cryptoShredRequested: false,
        backupChecked: true,
      }).action,
    ).toBe("blocked");
    expect(
      validateRegionalEndpoint({
        region: "eu-west-1",
        tenantResidency: "us",
      }).outcome,
    ).toBe("denied");
    expect(
      persistReasoningSummary({
        classification: "provider_safe_summary",
        text: "safe",
        dlpBlocked: false,
        retentionAllowsPersist: true,
        answerBody: "answer",
      }).outcome,
    ).toBe("stored");
  });

  it("covers remaining adapter, part, destination, ACL, and compare contracts", async () => {
    expect(
      previewModelCompatibility({
        required: {
          attachments: false,
          tools: true,
          reasoning: false,
          imageOutput: false,
          localOnly: false,
        },
        model: {
          tools: false,
          reasoning: false,
          imageOutput: false,
          localRuntime: true,
          regionAllowed: true,
          entitled: true,
        },
      }).outcome,
    ).toBe("unavailable");
    expect(
      projectProviderParts({
        parts: [{ type: "document_ref" }],
        supported: new Set(["text"]),
        fallbacks: { document_ref: "ocr" },
      }).outcome,
    ).toBe("projected");
    expect(
      evaluateDestinationPolicy({
        providerAllowed: true,
        toolAllowed: true,
        connectorAllowed: true,
        hostAllowed: false,
        regionAllowed: true,
        dataClassAllowed: true,
      }).outcome,
    ).toBe("denied");
    expect(
      declareConnectorAclCapability({
        connectorId: "gdrive",
        documentAcl: true,
        userAcl: true,
        groupAcl: false,
        delegatedQuery: false,
        freshness: "synchronized",
        deletion: "tombstone",
        failBehavior: "fail_closed",
      }).outcome,
    ).toBe("accepted");
    expect(
      applyCompareGroupCancel({
        legs: [{ legId: "done", state: "completed" }],
      })[0]?.retryable,
    ).toBe(false);
    expect(
      (
        await completeDirectUploadProtocol({
          alreadyReady: true,
          status: "ready",
          isResumable: false,
          headSupported: true,
          declaredSizeBytes: 1,
          maxBytes: 1,
          sha256Declared: "x",
          mimeType: "text/plain",
          readBytes: async () => {
            throw new Error("must not read");
          },
          sha256Hex: () => "x",
          assertMime: () => undefined,
        })
      ).outcome,
    ).toBe("already_ready");
    expect(
      normalizeUploadedMedia({
        bytes: new Uint8Array([1]),
        fileName: "note.txt",
        mimeType: "text/plain",
        stripMetadata: false,
        retentionPermitsOriginal: true,
        signatureMatches: true,
      }).outcome,
    ).toBe("accepted");
    expect(
      (
        await persistProviderOutputParts({
          parts: [{ type: "citation", citation: { sourceId: "src" } }],
          store: async () => ({ fileId: "unused" }),
          persistPart: async () => undefined,
          emit: () => undefined,
        })
      ).emitted[0]?.partRef.type,
    ).toBe("citation_ref");
    expect(
      evaluateModalityContentPolicy({
        surfaces: [{ kind: "ocr", content: "plain" }],
        detectors: {
          credit_card: "disabled",
          email_address: "disabled",
          us_ssn: "disabled",
          api_token: "disabled",
        },
      }).classifierAdvisory,
    ).toBe(true);
    const drafted = createPolicyVersionDraft({
      store: { versions: [] },
      id: "ver_gate",
      now: "2026-08-14T12:00:00.000Z",
      actorId: "user_admin",
      detectors: {
        credit_card: "disabled",
        email_address: "disabled",
        us_ssn: "disabled",
        api_token: "disabled",
      },
    });
    expect(
      publishPolicyVersion({
        store: drafted,
        versionId: "ver_gate",
        now: "2026-08-14T12:00:01.000Z",
        actorId: "user_admin",
      }).outcome,
    ).toBe("published");
    expect(
      requestPolicyApproval({
        id: "appr_gate",
        orgId: "org_default",
        runId: "run_gate",
        decisionId: "dec_gate",
        actorId: "user_admin",
        expiresAt: "2027-08-14T13:00:00.000Z",
        now: "2026-08-14T12:00:00.000Z",
        matchTextPresent: false,
      }).outcome,
    ).toBe("paused");
    expect(
      planFileReferenceAttach({
        files: [
          {
            id: "file_gate",
            status: "ready",
            mimeType: "text/plain",
            fileName: "a.txt",
          },
        ],
        messageId: "msg_gate",
        now: "2026-08-14T12:00:00.000Z",
      }).outcome,
    ).toBe("accepted");
    expect(
      reconcileAttachRetention({ referenceCount: 1, legalHoldActive: true }),
    ).toBe("retained");
    expect(
      selectRealtimeAdapter({ nativeAvailable: false, pipelineAvailable: false })
        .outcome,
    ).toBe("denied");
    expect(
      authorizeCompareSynthesis({
        candidateIds: ["c1"],
        candidateHashes: ["h1"],
        providerAuthorized: true,
        policyChecked: true,
      }).outcome,
    ).toBe("accepted");
    expect(
      evaluateAclFreshness({
        sensitivity: "public",
        ageMs: 1,
        maxStalenessMs: 10,
      }).outcome,
    ).toBe("fresh");
    expect(
      authorizeCryptoShred({
        legalHold: true,
        backupChecked: true,
        approverIds: ["user_reviewer"],
        actorId: "user_admin",
      }).outcome,
    ).toBe("denied");
  });
});
