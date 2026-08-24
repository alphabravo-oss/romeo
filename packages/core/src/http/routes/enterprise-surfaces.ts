import {
  cancelImageJobRoute,
  createCompareSessionRoute,
  createComputeJobRoute,
  createImageJobRoute,
  createRealtimeSessionRoute,
  evaluateFirewallOutputRoute,
  evaluateKnowledgeAclFreshnessRoute,
  getTrustPostureRoute,
  prefilterKnowledgeAclRoute,
  previewCompareSynthesisRoute,
  previewCryptoShredRoute,
  previewRealtimeAdapterRoute,
  sealAuditSegmentRoute,
  checkpointSiemExportRoute,
  authorizeBreakGlassRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
import { authorizeComputeJob } from "../../services/compute-runner-protocol";
import { preflightCompareSession } from "../../services/compare-preflight";
import { prefilterKnowledgeCandidates } from "../../services/knowledge-acl-prefilter";
import {
  applyOutputPolicyBeforePersist,
  OutputPolicyBuffer,
} from "../../services/output-policy-buffer";
import { authorizeCompareSynthesis } from "../../services/compare-synthesis";
import { evaluateAclFreshness } from "../../services/knowledge-acl-lifecycle";
import { authorizeRealtimeSession } from "../../services/realtime-session-policy";
import { selectRealtimeAdapter } from "../../services/realtime-voice-contracts";
import { authorizeCryptoShred } from "../../services/tenant-crypto-lifecycle";
import { authorizeBreakGlass } from "../../services/break-glass";
import { createId } from "../../ids";
import { CONTENT_POLICY_DETECTOR_CODES } from "../../services/content-policy-service";
import { assertCapabilityFlagEnabled } from "../../services/capability-flag-enforcement";
import { resolveIdempotencyKey } from "../../services/idempotency-service";
import { applyIdempotencyHeaders } from "../idempotency-response";
import {
  authorizeGenericCapability,
  capabilityDeniesOperation,
  singletonWorkspaceContext,
} from "../../services/capability-consumer-enforcement";

export function registerEnterpriseSurfaceRoutes(app: RomeoApi): void {
  app.openapi(createRealtimeSessionRoute, async (context) => {
    const body = context.req.valid("json");
    const flag = await context
      .get("services")
      .capabilityFlags.resolve(context.get("subject"), "realtime_voice_v1");
    const effective = await context.get("services").capabilities.resolve({
      subject: context.get("subject"),
      capabilityId: "realtime_voice",
    });
    const data = authorizeRealtimeSession({
      platformDisabled:
        capabilityDeniesOperation(effective) ||
        flag.effectiveState !== "enabled",
      gatewayInstalled: false,
      retention: body.retention,
      durationSeconds: body.durationSeconds,
      maxDurationSeconds: 1_800,
    });
    return context.json({ data }, 200);
  });
  app.openapi(createComputeJobRoute, async (context) => {
    const key = resolveIdempotencyKey(
      context.req.header("idempotency-key") ?? undefined,
      undefined,
    );
    const result = await context.get("services").idempotency.execute({
      subject: context.get("subject"),
      operation: "compute.jobs.create",
      ...(key === undefined ? {} : { key }),
      request: { workspaceId: "workspace_default" },
      responseStatus: 200,
      work: async () => {
        const flag = await context
          .get("services")
          .capabilityFlags.resolve(
            context.get("subject"),
            "compute_artifacts_v1",
          );
        const effective = await context.get("services").capabilities.resolve({
          subject: context.get("subject"),
          capabilityId: "secure_compute",
        });
        return authorizeComputeJob({
          platformDisabled:
            capabilityDeniesOperation(effective) ||
            flag.effectiveState !== "enabled",
          runtime: "uninstalled",
          jobId: "compute_uninstalled",
        });
      },
    });
    applyIdempotencyHeaders(context, result.idempotency);
    return context.json({ data: result.value }, 200);
  });
  app.openapi(createCompareSessionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const key = resolveIdempotencyKey(
      context.req.header("idempotency-key") ?? undefined,
      undefined,
    );
    const result = await context.get("services").idempotency.execute({
      subject,
      operation: "compare.sessions.start",
      ...(key === undefined ? {} : { key }),
      request: {
        workspaceId: body.workspaceId,
        modelIds: body.modelIds,
        maxAggregateMicroUsd: body.maxAggregateMicroUsd,
      },
      responseStatus: 200,
      work: async () => {
        const flag = await context
          .get("services")
          .capabilityFlags.resolve(subject, "compare_consensus_v1");
        const effective = await context.get("services").capabilities.resolve({
          subject,
          capabilityId: "multi_model_compare",
          workspaceId: body.workspaceId,
        });
        return preflightCompareSession({
          platformDisabled:
            capabilityDeniesOperation(effective) ||
            flag.effectiveState !== "enabled",
          maxLegs: 8,
          maxAggregateMicroUsd: body.maxAggregateMicroUsd,
          legs: await context
            .get("services")
            .modelCapabilityProbes.authorizeCompareLegs(subject, body.modelIds),
        });
      },
    });
    applyIdempotencyHeaders(context, result.idempotency);
    return context.json({ data: result.value }, 200);
  });
  app.openapi(evaluateFirewallOutputRoute, async (context) => {
    await context
      .get("services")
      .capabilityFlags.resolve(context.get("subject"), "content_firewall_v2");
    await authorizeGenericCapability(
      context.get("services").capabilities,
      context.get("subject"),
      "content_firewall",
      singletonWorkspaceContext(context.get("subject").workspaceIds),
    );
    const body = context.req.valid("json");
    const buffer = new OutputPolicyBuffer({
      mode: body.mode,
      detectors: Object.fromEntries(
        CONTENT_POLICY_DETECTOR_CODES.map((code) => [code, "block"]),
      ) as never,
      failClosed: true,
    });
    const persisted: string[] = [];
    let last = buffer.consume("");
    for (const chunk of body.chunks) {
      last = applyOutputPolicyBeforePersist({
        buffer,
        chunk,
        persist: (text) => persisted.push(text),
        emit: () => undefined,
      });
      if (last.action === "block") break;
    }
    if (last.action !== "block") last = buffer.finish();
    return context.json(
      {
        data: {
          action: last.action,
          ...("code" in last ? { code: last.code } : {}),
          ...("detectors" in last ? { detectors: last.detectors } : {}),
          releasedCharacters: persisted.join("").length,
        },
      },
      200,
    );
  });

  app.openapi(prefilterKnowledgeAclRoute, async (context) => {
    await assertCapabilityFlagEnabled(
      context.get("services").capabilityFlags,
      context.get("subject"),
      "knowledge_acl_v2",
    );
    const body = context.req.valid("json");
    await authorizeGenericCapability(
      context.get("services").capabilities,
      context.get("subject"),
      "knowledge_acl",
      { workspaceId: body.workspaceId },
    );
    const decision = prefilterKnowledgeCandidates({
      candidates: body.documentIds.map((documentId) => ({
        sourceId: body.workspaceId,
        documentId,
        aclRevision: "acl_unknown",
        syncedAt: new Date(0).toISOString(),
      })),
      bindings: [],
      principalId: context.get("subject").id,
      now: new Date().toISOString(),
      maxStalenessMs: 0,
      failClosedWhenStale: true,
    });
    return context.json(
      {
        data: {
          allowedDocumentCount: decision.allowed.length,
          deniedCount: decision.deniedCount,
          ...(decision.reasonCode === undefined
            ? {}
            : { reasonCode: decision.reasonCode }),
        },
      },
      200,
    );
  });

  app.openapi(getTrustPostureRoute, async (context) => {
    await context
      .get("services")
      .capabilityFlags.resolve(context.get("subject"), "trust_plane_v1");
    const auditExport = await context
      .get("services")
      .auditIntegrity.exportPosture(context.get("subject"));
    return context.json(
      {
        data: {
          keys: "not_configured" as const,
          residency: "not_configured" as const,
          dlp: "not_applicable" as const,
          acl: "not_configured" as const,
          auditExport,
          syntheticGreen: false as const,
        },
      },
      200,
    );
  });

  app.openapi(createImageJobRoute, async (context) => {
    const body = context.req.valid("json");
    const key = resolveIdempotencyKey(
      context.req.header("idempotency-key") ?? undefined,
      undefined,
    );
    const result = await context.get("services").idempotency.execute({
      subject: context.get("subject"),
      operation: "media.jobs.create",
      ...(key === undefined ? {} : { key }),
      request: {
        workspaceId: body.workspaceId,
        kind: body.kind,
        sourceFileId: body.sourceFileId,
      },
      responseStatus: 200,
      work: async () => {
        const effective = await context.get("services").capabilities.resolve({
          subject: context.get("subject"),
          capabilityId: "image_editing",
          workspaceId: body.workspaceId,
        });
        return context.get("services").imageJobs.create({
          subject: context.get("subject"),
          workspaceId: body.workspaceId,
          kind: body.kind,
          platformDisabled: capabilityDeniesOperation(effective),
          ...(body.sourceFileId === undefined
            ? {}
            : { sourceFileId: body.sourceFileId }),
        });
      },
    });
    applyIdempotencyHeaders(context, result.idempotency);
    const data = result.value;
    return context.json(
      {
        data: {
          outcome: data.outcome,
          ...(data.outcome === "denied" ? { code: data.code } : {}),
          ...(data.outcome === "accepted"
            ? { jobId: data.job.id, state: data.job.state }
            : {}),
        },
      },
      200,
    );
  });

  app.openapi(cancelImageJobRoute, async (context) => {
    const { jobId } = context.req.valid("param");
    const data = await context.get("services").imageJobs.cancel({
      subject: context.get("subject"),
      jobId,
    });
    return context.json(
      {
        data: {
          outcome: data.outcome,
          ...(data.outcome === "denied" ? { code: data.code } : {}),
          ...(data.outcome === "accepted"
            ? { jobId: data.job.id, state: data.job.state }
            : {}),
        },
      },
      200,
    );
  });

  app.openapi(previewRealtimeAdapterRoute, async (context) => {
    const body = context.req.valid("json");
    await authorizeGenericCapability(
      context.get("services").capabilities,
      context.get("subject"),
      "realtime_voice",
    );
    const data = selectRealtimeAdapter(body);
    return context.json(
      {
        data: {
          outcome: data.outcome,
          ...(data.outcome === "accepted" ? { adapter: data.adapter } : {}),
          ...(data.outcome === "denied" ? { fallback: data.fallback } : {}),
        },
      },
      200,
    );
  });

  app.openapi(previewCompareSynthesisRoute, async (context) => {
    const body = context.req.valid("json");
    await authorizeGenericCapability(
      context.get("services").capabilities,
      context.get("subject"),
      "multi_model_compare",
      singletonWorkspaceContext(context.get("subject").workspaceIds),
    );
    const data = authorizeCompareSynthesis({
      candidateIds: body.candidateIds,
      candidateHashes: body.candidateHashes,
      providerAuthorized: body.providerAuthorized,
      policyChecked: true,
    });
    return context.json(
      {
        data: {
          outcome: data.outcome,
          ...(data.outcome === "accepted" ? { citations: data.citations } : {}),
        },
      },
      200,
    );
  });

  app.openapi(evaluateKnowledgeAclFreshnessRoute, async (context) => {
    const body = context.req.valid("json");
    await authorizeGenericCapability(
      context.get("services").capabilities,
      context.get("subject"),
      "knowledge_acl",
      singletonWorkspaceContext(context.get("subject").workspaceIds),
    );
    const data = evaluateAclFreshness(body);
    return context.json(
      {
        data: {
          outcome: data.outcome,
          ...(data.outcome === "stale" ? { failClosed: data.failClosed } : {}),
          ...("code" in data ? { code: data.code } : {}),
        },
      },
      200,
    );
  });

  app.openapi(previewCryptoShredRoute, async (context) => {
    const body = context.req.valid("json");
    await authorizeGenericCapability(
      context.get("services").capabilities,
      context.get("subject"),
      "tenant_encryption",
    );
    const data = authorizeCryptoShred({
      legalHold: body.legalHold,
      backupChecked: body.backupChecked,
      approverIds: body.approverIds,
      actorId: context.get("subject").id,
    });
    return context.json(
      {
        data: {
          outcome: data.outcome,
          ...(data.outcome === "accepted"
            ? {
                executed: false as const,
                externalCopiesClaimed: false as const,
                keysDestroyed: false as const,
                preview: true as const,
              }
            : {}),
        },
      },
      200,
    );
  });

  app.openapi(sealAuditSegmentRoute, async (context) => {
    const body = context.req.valid("json");
    const sealed = await context.get("services").auditIntegrity.seal({
      subject: context.get("subject"),
      ...(body.maxRecords === undefined
        ? body.eventIds === undefined
          ? {}
          : { maxRecords: Math.max(1, body.eventIds.length) }
        : { maxRecords: body.maxRecords }),
    });
    return context.json(
      {
        data:
          sealed.outcome === "accepted"
            ? {
                algorithm: sealed.checkpoint.algorithm,
                checkpointId: sealed.checkpoint.id,
                eventCount: sealed.checkpoint.recordCount,
                fromSequence: sealed.checkpoint.fromSequence,
                keyVersion: sealed.checkpoint.keyVersion,
                outcome: "accepted" as const,
                previousHash: sealed.checkpoint.previousCheckpointHash,
                rootHash: sealed.checkpoint.rootHash,
                segmentHash: sealed.checkpoint.checkpointHash,
                signature: sealed.checkpoint.signature,
                toSequence: sealed.checkpoint.toSequence,
              }
            : { code: sealed.code, outcome: "denied" as const },
      },
      200,
    );
  });

  app.openapi(checkpointSiemExportRoute, async (context) => {
    const body = context.req.valid("json");
    const key = resolveIdempotencyKey(
      context.req.header("idempotency-key") ?? undefined,
      body.idempotencyKey,
    );
    const checkpointHash = body.checkpointHash ?? body.segmentHash;
    const data = await context.get("services").auditIntegrity.checkpointExport({
      destination: body.destination,
      idempotencyKey: key ?? createId("audit_export_legacy"),
      subject: context.get("subject"),
      ...(checkpointHash === undefined ? {} : { checkpointHash }),
    });
    return context.json(
      {
        data: {
          destination: data.destination,
          duplicate: data.duplicate,
          jobId: data.jobId,
          lagMs: data.lagMs,
          state: data.state,
        },
      },
      200,
    );
  });

  app.openapi(authorizeBreakGlassRoute, (context) => {
    const body = context.req.valid("json");
    const data = authorizeBreakGlass({
      actorId: context.get("subject").id,
      approverId: body.approverId,
      now: new Date().toISOString(),
      reason: body.reason,
      requestedControls: body.requestedControls,
      ttlMinutes: body.ttlMinutes,
    });
    return context.json(
      {
        data:
          data.outcome === "accepted"
            ? {
                alerted: false as const,
                executed: false as const,
                expiresAt: data.expiresAt,
                outcome: "accepted" as const,
                preview: true as const,
              }
            : { code: data.code, outcome: "denied" as const },
      },
      200,
    );
  });
}
