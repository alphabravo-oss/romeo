import type { RunEvent } from "@romeo/ai-runtime";
import type { ContentPolicyDetectorCode } from "./content-policy-service";

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
import type { RunKnowledgeCitation } from "./run-knowledge";

export function gateStreamedOutputDelta(input: {
  buffer: OutputPolicyBuffer;
  text: string;
  approvalRequired?: boolean;
}):
  | { outcome: "hold" }
  | { outcome: "release"; text: string }
  | { outcome: "block"; code: string; detectors: ContentPolicyDetectorCode[] }
  | {
      outcome: "pause";
      code: "content_policy_approval_required";
      detectors: ContentPolicyDetectorCode[];
    } {
  const released: string[] = [];
  const result = applyOutputPolicyBeforePersist({
    buffer: input.buffer,
    chunk: input.text,
    persist: (text) => released.push(text),
    emit: () => undefined,
  });
  return interpretRelease(
    result,
    released.join(""),
    input.approvalRequired === true,
  );
}

export function finishStreamedOutput(input: {
  buffer: OutputPolicyBuffer;
  approvalRequired?: boolean;
}):
  | { outcome: "hold" }
  | { outcome: "release"; text: string }
  | { outcome: "block"; code: string; detectors: ContentPolicyDetectorCode[] }
  | {
      outcome: "pause";
      code: "content_policy_approval_required";
      detectors: ContentPolicyDetectorCode[];
    } {
  const result = input.buffer.finish();
  const text = result.action === "release" ? result.text : "";
  return interpretRelease(result, text, input.approvalRequired === true);
}

export function authoritativeTerminalPolicyOutcome(input: {
  policy: OutputPolicyRelease;
  providerEvent: RunEvent;
}): {
  assistantText: string;
  executionOutcome: "completed" | "failed";
  terminalEvent: RunEvent;
} {
  if (input.policy.action === "release") {
    return {
      assistantText: input.policy.text,
      executionOutcome:
        input.providerEvent.type === "run.completed" ? "completed" : "failed",
      terminalEvent: input.providerEvent,
    };
  }
  const errorCode =
    input.policy.action === "block"
      ? input.policy.code
      : "content_policy_unavailable";
  const providerData =
    typeof input.providerEvent.data === "object" &&
    input.providerEvent.data !== null &&
    !Array.isArray(input.providerEvent.data)
      ? (input.providerEvent.data as Record<string, unknown>)
      : {};
  return {
    assistantText: "",
    executionOutcome: "failed",
    terminalEvent: {
      ...input.providerEvent,
      type: "run.failed",
      data: {
        channel: "content_policy",
        errorCode,
        ...(providerData.providerFallback === undefined
          ? {}
          : { providerFallback: providerData.providerFallback }),
        ...(providerData.usage === undefined
          ? {}
          : { usage: providerData.usage }),
      },
    },
  };
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
  citations: RunKnowledgeCitation[];
  event: Pick<RunEvent, "data">;
  store: (
    part: Required<Pick<ProviderOutputPart, "bytes" | "mediaType" | "type">> &
      Pick<ProviderOutputPart, "durationMs">,
  ) => Promise<{ fileId: string }>;
  persistPart: (part: PersistedOutputPartRef) => Promise<void>;
}): Promise<OutputPartReadyEvent[]> {
  const parts: ProviderOutputPart[] = extractProviderOutputParts(
    input.event.data,
  );
  if (parts.length === 0) return [];
  const emitted: OutputPartReadyEvent[] = [];
  await persistProviderOutputParts({
    parts,
    store: input.store,
    persistPart: input.persistPart,
    authorizeCitation: async (requested) => {
      const citation = input.citations.find(
        (candidate) =>
          candidate.documentId === requested.sourceId &&
          (requested.chunkId === undefined ||
            candidate.chunkId === requested.chunkId),
      );
      return citation === undefined
        ? undefined
        : { documentId: citation.documentId, title: citation.title };
    },
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
  | { outcome: "block"; code: string; detectors: ContentPolicyDetectorCode[] }
  | {
      outcome: "pause";
      code: "content_policy_approval_required";
      detectors: ContentPolicyDetectorCode[];
    } {
  if (result.action === "hold") return { outcome: "hold" };
  if (result.action === "release") return { outcome: "release", text };
  if (approvalRequired)
    return {
      outcome: "pause",
      code: "content_policy_approval_required",
      detectors: result.detectors,
    };
  return { outcome: "block", code: result.code, detectors: result.detectors };
}
