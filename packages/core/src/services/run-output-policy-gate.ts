import type { RunEvent } from "@romeo/ai-runtime";

import {
  applyOutputPolicyBeforePersist,
  OutputPolicyBuffer,
  type OutputPolicyRelease,
} from "./output-policy-buffer";
import {
  extractProviderOutputParts,
  persistProviderOutputParts,
  type OutputPartReadyEvent,
  type PersistedOutputPartRef,
  type ProviderOutputPart,
} from "./persist-output-parts";
import { requestPolicyApproval } from "./policy-approval";

export function gateStreamedOutputDelta(input: {
  buffer: OutputPolicyBuffer;
  text: string;
  approvalRequired?: boolean;
}):
  | { outcome: "hold" }
  | { outcome: "release"; text: string }
  | { outcome: "block"; code: string; detectors: string[] }
  | { outcome: "pause"; code: "content_policy_approval_required" } {
  const released: string[] = [];
  const result = applyOutputPolicyBeforePersist({
    buffer: input.buffer,
    chunk: input.text,
    persist: (text) => released.push(text),
    emit: () => undefined,
  });
  return interpretRelease(result, released.join(""), input.approvalRequired === true);
}

export function finishStreamedOutput(input: {
  buffer: OutputPolicyBuffer;
  approvalRequired?: boolean;
}):
  | { outcome: "hold" }
  | { outcome: "release"; text: string }
  | { outcome: "block"; code: string; detectors: string[] }
  | { outcome: "pause"; code: "content_policy_approval_required" } {
  const result = input.buffer.finish();
  const text = result.action === "release" ? result.text : "";
  return interpretRelease(result, text, input.approvalRequired === true);
}

export function pauseRunForPolicyApproval(input: {
  id: string;
  orgId: string;
  runId: string;
  decisionId: string;
  actorId: string;
  expiresAt: string;
  now: string;
}) {
  return requestPolicyApproval({
    ...input,
    matchTextPresent: false,
  });
}

export async function persistAndEmitOutputParts(input: {
  event: Pick<RunEvent, "data">;
  store: (bytes: Uint8Array, mediaType: string) => Promise<{ fileId: string }>;
  persistPart: (part: PersistedOutputPartRef) => Promise<void>;
}): Promise<OutputPartReadyEvent[]> {
  const parts: ProviderOutputPart[] = extractProviderOutputParts(input.event.data);
  if (parts.length === 0) return [];
  const emitted: OutputPartReadyEvent[] = [];
  await persistProviderOutputParts({
    parts,
    store: input.store,
    persistPart: input.persistPart,
    emit: (event) => emitted.push(event),
  });
  return emitted;
}

function interpretRelease(
  result: OutputPolicyRelease,
  text: string,
  approvalRequired: boolean,
):
  | { outcome: "hold" }
  | { outcome: "release"; text: string }
  | { outcome: "block"; code: string; detectors: string[] }
  | { outcome: "pause"; code: "content_policy_approval_required" } {
  if (result.action === "hold") return { outcome: "hold" };
  if (result.action === "release") return { outcome: "release", text };
  if (approvalRequired)
    return { outcome: "pause", code: "content_policy_approval_required" };
  return { outcome: "block", code: result.code, detectors: result.detectors };
}
