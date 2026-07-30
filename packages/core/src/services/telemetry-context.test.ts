import { describe, expect, it, vi } from "vitest";
import type { AuthSubject } from "@romeo/auth";
import { MemoryObjectStore } from "@romeo/storage";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { recordUsage } from "./record-usage";
import {
  continueTelemetryContextFromPayload,
  currentTelemetryMetadata,
  runWithTelemetryContext,
  telemetryJobPayload,
  metadataTraceChannel,
  reportCleanupFailure,
  telemetryTraceId,
  withTelemetryFetch,
  withTelemetryObjectStore,
} from "./telemetry-context";
import { traceSubjectOperation } from "./trace-operation";

const subject: AuthSubject = {
  id: "user_dev_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: [],
};

describe("metadata-only telemetry context", () => {
  it("propagates trace correlation into usage and outbound boundary headers", async () => {
    const repository = new InMemoryRomeoRepository();
    const traceId = "0123456789abcdef0123456789abcdef";
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-romeo-trace-id")).toBe(traceId);
      expect(headers.get("traceparent")).toMatch(
        new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`, "u"),
      );
      return new Response("ok");
    });

    await runWithTelemetryContext(
      { requestId: "req_telemetry", traceId },
      async () => {
        await recordUsage(repository, {
          orgId: "org_default",
          actorId: "user_dev_admin",
          sourceType: "run",
          sourceId: "run_telemetry",
          metric: "telemetry.test",
          quantity: 1,
          unit: "event",
          metadata: { boundary: "provider" },
        });
        await withTelemetryFetch(fetchImpl)("https://provider.example/v1");
      },
    );
    const usage = await repository.listUsageEvents("org_default");

    expect(usage.at(-1)?.metadata).toEqual({
      boundary: "provider",
      requestId: "req_telemetry",
      traceId,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("accepts a valid W3C parent trace id and rejects arbitrary trace labels", () => {
    const parent = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(
      telemetryTraceId({
        traceparent: `00-${parent}-bbbbbbbbbbbbbbbb-01`,
      }),
    ).toBe(parent);
    expect(telemetryTraceId({ traceId: "not-a-trace" })).toMatch(
      /^[0-9a-f]{32}$/u,
    );
  });

  it("persists and resumes only validated worker correlation metadata", () => {
    const traceId = "cccccccccccccccccccccccccccccccc";
    const payload = runWithTelemetryContext(
      { requestId: "req_worker_origin", traceId },
      () => telemetryJobPayload({ task: "safe_metadata" }),
    );

    expect(payload).toEqual({
      task: "safe_metadata",
      requestId: "req_worker_origin",
      traceId,
    });
    expect(continueTelemetryContextFromPayload(payload)).toBe(true);
    expect(currentTelemetryMetadata()).toEqual({
      requestId: "req_worker_origin",
      traceId,
    });
    expect(
      continueTelemetryContextFromPayload({
        requestId: "req_invalid",
        traceId: "caller-controlled-label",
      }),
    ).toBe(false);
  });

  it("records redaction-safe object-store failure spans", async () => {
    const repository = new InMemoryRomeoRepository();
    const traceId = "dddddddddddddddddddddddddddddddd";
    const rawSentinel = "RAW_OBJECT_KEY_AND_ERROR_SENTINEL";

    await expect(
      runWithTelemetryContext({ requestId: "req_storage", traceId }, () =>
        traceSubjectOperation({
          repository,
          subject,
          workspaceId: "workspace_default",
          sourceId: "file_safe_id",
          boundary: "object_store",
          operation: "get_content",
          execute: async () => {
            throw new Error(rawSentinel);
          },
        }),
      ),
    ).rejects.toThrow(rawSentinel);

    const usage = await repository.listUsageEvents("org_default");
    expect(usage.at(-1)).toMatchObject({
      sourceId: "file_safe_id",
      metric: "trace.span",
      unit: "millisecond",
      metadata: {
        boundary: "object_store",
        operation: "get_content",
        outcome: "failure",
        requestId: "req_storage",
        traceId,
      },
    });
    expect(JSON.stringify(usage)).not.toContain(rawSentinel);
  });

  it("traces every object-store method without publishing keys or bodies", async () => {
    const store = withTelemetryObjectStore(new MemoryObjectStore());
    const rawSentinel = "RAW_OBJECT_KEY_BODY_SENTINEL";
    const spans: unknown[] = [];
    const listener = (span: unknown) => spans.push(span);
    metadataTraceChannel.subscribe(listener);
    try {
      await runWithTelemetryContext(
        {
          requestId: "req_all_storage_methods",
          traceId: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        },
        async () => {
          await store.putObject({
            key: rawSentinel,
            body: new TextEncoder().encode(rawSentinel),
            contentType: "text/plain",
          });
          await store.getObject(rawSentinel);
          await store.createPresignedUpload({
            key: rawSentinel,
            contentType: "text/plain",
            expiresInSeconds: 60,
          });
          await store.deleteObject(rawSentinel);
        },
      );
    } finally {
      metadataTraceChannel.unsubscribe(listener);
    }

    expect(spans).toHaveLength(4);
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "put", outcome: "success" }),
        expect.objectContaining({ operation: "get", outcome: "success" }),
        expect.objectContaining({
          operation: "presign_put",
          outcome: "success",
        }),
        expect.objectContaining({ operation: "delete", outcome: "success" }),
      ]),
    );
    expect(JSON.stringify(spans)).not.toContain(rawSentinel);
  });

  it("publishes redaction-safe evidence for swallowed cleanup failures", () => {
    const spans: unknown[] = [];
    const listener = (span: unknown) => spans.push(span);
    metadataTraceChannel.subscribe(listener);
    try {
      runWithTelemetryContext(
        {
          requestId: "req_cleanup",
          traceId: "ffffffffffffffffffffffffffffffff",
        },
        () => reportCleanupFailure("knowledge_source.restore_content"),
      );
    } finally {
      metadataTraceChannel.unsubscribe(listener);
    }
    expect(spans).toEqual([
      {
        boundary: "cleanup",
        durationMs: 0,
        operation: "knowledge_source.restore_content",
        outcome: "failure",
        requestId: "req_cleanup",
        traceId: "ffffffffffffffffffffffffffffffff",
      },
    ]);
  });
});
