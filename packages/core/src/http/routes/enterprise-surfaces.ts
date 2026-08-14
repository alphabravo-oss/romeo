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
import {
  checkpointSiemExport,
  sealAuditSegment,
} from "../../services/audit-integrity";
import { authorizeBreakGlass } from "../../services/break-glass";
import { CONTENT_POLICY_DETECTOR_CODES } from "../../services/content-policy-service";
import { assertCapabilityFlagEnabled } from "../../services/capability-flag-enforcement";
import { resolveIdempotencyKey } from "../../services/idempotency-service";
import { applyIdempotencyHeaders } from "../idempotency-response";

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
        effective.status === "disabled" || flag.effectiveState !== "enabled",
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
        const effective = await context
          .get("services")
          .capabilities.resolve({
            subject: context.get("subject"),
            capabilityId: "secure_compute",
          });
        return authorizeComputeJob({
          platformDisabled:
            effective.status === "disabled" || flag.effectiveState !== "enabled",
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
            effective.status === "disabled" || flag.effectiveState !== "enabled",
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
    return context.json(
      {
        data: {
          keys: "not_configured" as const,
          residency: "not_configured" as const,
          dlp: "not_applicable" as const,
          acl: "not_configured" as const,
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
          platformDisabled: effective.status === "disabled",
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
            ? { externalCopiesClaimed: false as const }
            : {}),
        },
      },
      200,
    );
  });

  app.openapi(sealAuditSegmentRoute, (context) => {
    const body = context.req.valid("json");
    const sealed = sealAuditSegment({
      eventIds: body.eventIds,
      now: new Date().toISOString(),
      signingKeyVersion: body.signingKeyVersion,
      ...(body.previousHash === undefined
        ? {}
        : { previousHash: body.previousHash }),
    });
    return context.json(
      {
        data:
          sealed.outcome === "accepted"
            ? {
                eventCount: sealed.segment.eventCount,
                outcome: "accepted" as const,
                previousHash: sealed.segment.previousHash,
                segmentHash: sealed.segment.segmentHash,
              }
            : { code: sealed.code, outcome: "denied" as const },
      },
      200,
    );
  });

  app.openapi(checkpointSiemExportRoute, (context) => {
    const body = context.req.valid("json");
    const data = checkpointSiemExport({
      attempt: body.attempt,
      destination: body.destination,
      now: new Date().toISOString(),
      sealedAt: body.sealedAt,
      segmentHash: body.segmentHash,
      ...(body.priorReceiptHash === undefined
        ? {}
        : { priorReceiptHash: body.priorReceiptHash }),
      ...(body.receiptHash === undefined ? {} : { receiptHash: body.receiptHash }),
    });
    return context.json(
      {
        data: {
          destination: data.destination,
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
                alerted: true as const,
                expiresAt: data.expiresAt,
                outcome: "accepted" as const,
              }
            : { code: data.code, outcome: "denied" as const },
      },
      200,
    );
  });
}
