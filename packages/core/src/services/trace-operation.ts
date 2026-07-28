import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { recordSubjectUsage } from "./record-usage";

/**
 * Records a deliberately metadata-only span around an infrastructure boundary.
 * Callers must use stable operation names and must never add object keys, URLs,
 * request/response bodies, file names, prompts, or raw error messages.
 */
export async function traceSubjectOperation<T>(input: {
  repository: RomeoRepository;
  subject: AuthSubject;
  workspaceId?: string;
  sourceId: string;
  boundary: "object_store" | "worker";
  operation: string;
  execute: () => Promise<T>;
}): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await input.execute();
    await recordSpan(input, startedAt, "success");
    return result;
  } catch (error) {
    await recordSpan(input, startedAt, "failure");
    throw error;
  }
}

async function recordSpan(
  input: Omit<Parameters<typeof traceSubjectOperation>[0], "execute">,
  startedAt: number,
  outcome: "failure" | "success",
): Promise<void> {
  await recordSubjectUsage(input.repository, input.subject, {
    orgId: input.subject.orgId,
    ...(input.workspaceId === undefined
      ? {}
      : { workspaceId: input.workspaceId }),
    sourceType: "storage",
    sourceId: input.sourceId,
    metric: "trace.span",
    quantity: Math.max(0, Date.now() - startedAt),
    unit: "millisecond",
    metadata: {
      boundary: input.boundary,
      operation: input.operation,
      outcome,
    },
  }).catch(() => undefined);
}
