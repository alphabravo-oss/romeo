import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { channel } from "node:diagnostics_channel";

import type { ObjectStore } from "@romeo/storage";

export interface TelemetryContext {
  requestId: string;
  traceId: string;
}

const storage = new AsyncLocalStorage<TelemetryContext>();
export const metadataTraceChannel = channel("romeo.telemetry.span");

export interface MetadataTraceSpan {
  boundary: "object_store";
  durationMs: number;
  operation: "delete" | "get" | "presign_put" | "put";
  outcome: "failure" | "success";
  requestId?: string;
  traceId?: string;
}

export function runWithTelemetryContext<T>(
  context: TelemetryContext,
  operation: () => T,
): T {
  return storage.run(context, operation);
}

export function continueTelemetryContext(context: TelemetryContext): void {
  storage.enterWith(context);
}

export function currentTelemetryMetadata(): Record<string, string> {
  const context = storage.getStore();
  return context === undefined
    ? {}
    : { requestId: context.requestId, traceId: context.traceId };
}

export function telemetryJobPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return { ...payload, ...currentTelemetryMetadata() };
}

export function continueTelemetryContextFromPayload(
  payload: Record<string, unknown>,
): boolean {
  const requestId = payload.requestId;
  const traceId = payload.traceId;
  if (
    typeof requestId !== "string" ||
    requestId.length === 0 ||
    typeof traceId !== "string" ||
    !/^[0-9a-f]{32}$/u.test(traceId)
  )
    return false;
  continueTelemetryContext({ requestId, traceId });
  return true;
}

export function telemetryTraceId(input: {
  traceparent?: string;
  traceId?: string;
}): string {
  const parent = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/u.exec(
    input.traceparent?.trim().toLowerCase() ?? "",
  )?.[1];
  if (parent !== undefined && !/^0{32}$/u.test(parent)) return parent;
  const explicit = input.traceId?.trim().toLowerCase();
  if (explicit !== undefined && /^[0-9a-f]{32}$/u.test(explicit))
    return explicit;
  return randomBytes(16).toString("hex");
}

export function withTelemetryFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const context = storage.getStore();
    if (context === undefined) return fetchImpl(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("x-romeo-trace-id", context.traceId);
    headers.set(
      "traceparent",
      `00-${context.traceId}-${randomBytes(8).toString("hex")}-01`,
    );
    return fetchImpl(input, { ...init, headers });
  };
}

export function withTelemetryObjectStore(
  objectStore: ObjectStore,
): ObjectStore {
  const traced = <T>(
    operation: MetadataTraceSpan["operation"],
    execute: () => Promise<T>,
  ): Promise<T> => traceObjectStoreOperation(operation, execute);
  return {
    putObject: (input) => traced("put", () => objectStore.putObject(input)),
    getObject: (key) => traced("get", () => objectStore.getObject(key)),
    deleteObject: (key) =>
      traced("delete", () => objectStore.deleteObject(key)),
    createPresignedUpload: (input) =>
      traced("presign_put", () => objectStore.createPresignedUpload(input)),
  };
}

async function traceObjectStoreOperation<T>(
  operation: MetadataTraceSpan["operation"],
  execute: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await execute();
    publishObjectStoreSpan(operation, startedAt, "success");
    return result;
  } catch (error) {
    publishObjectStoreSpan(operation, startedAt, "failure");
    throw error;
  }
}

function publishObjectStoreSpan(
  operation: MetadataTraceSpan["operation"],
  startedAt: number,
  outcome: MetadataTraceSpan["outcome"],
): void {
  const context = storage.getStore();
  metadataTraceChannel.publish({
    boundary: "object_store",
    operation,
    outcome,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(context === undefined ? {} : context),
  } satisfies MetadataTraceSpan);
}
