import type { RunEvent } from "../features/runs";
import type { MessageKey } from "./i18n";
import type { ChatRunActivity } from "./run-registry-types";

/** Whole seconds of thinking, floored at 1 so a fast model still reports one. */
export function reasoningSeconds(firstAt: string, lastAt: string): number {
  const elapsed = Date.parse(lastAt) - Date.parse(firstAt);
  return Number.isFinite(elapsed)
    ? Math.max(1, Math.round(elapsed / 1_000))
    : 1;
}

export function providerRunFailure(
  event: Pick<RunEvent, "type" | "data">,
  t: (key: MessageKey) => string,
): { code: string; message: string } {
  if (event.type === "run.cancelled") {
    return { code: "run_cancelled", message: t("responseStopped") };
  }
  const record =
    typeof event.data === "object" && event.data !== null
      ? (event.data as Record<string, unknown>)
      : {};
  const errorCode =
    typeof record.errorCode === "string" && record.errorCode.trim().length > 0
      ? record.errorCode.trim()
      : "provider_run_failed";
  const errorType =
    typeof record.errorType === "string" ? record.errorType : "";
  if (errorCode === "provider_credential_unavailable") {
    return { code: errorCode, message: t("providerCredentialUnavailable") };
  }
  if (errorCode === "provider_stream_timeout") {
    return { code: errorCode, message: t("providerStreamTimeout") };
  }
  if (
    errorCode === "provider_stream_aborted" ||
    errorCode === "run_cancelled"
  ) {
    return { code: errorCode, message: t("responseStopped") };
  }
  if (errorType.endsWith("http_401"))
    return { code: errorCode, message: t("providerRejectedKey") };
  if (errorType.endsWith("http_403"))
    return { code: errorCode, message: t("providerDenied") };
  if (errorType.endsWith("http_404"))
    return { code: errorCode, message: t("providerNotFound") };
  if (errorType.endsWith("http_429"))
    return { code: errorCode, message: t("providerRateLimited") };
  if (/http_5\d\d$/u.test(errorType))
    return { code: errorCode, message: t("providerUnavailable") };
  return { code: errorCode, message: t("providerFailed") };
}

export function activityFromEvent(
  event: RunEvent,
  t: (key: MessageKey) => string,
): ChatRunActivity | undefined {
  const definitions: Partial<
    Record<RunEvent["type"], { label: string; state: ChatRunActivity["state"] }>
  > = {
    "run.started": {
      label: t("chatActivityGeneratingResponse"),
      state: "active",
    },
    "retrieval.completed": {
      label: t("chatActivitySourcesRetrieved"),
      state: "complete",
    },
    // tool.* is deliberately absent: a per-call card carries the tool's name,
    // arguments, result shape and duration, which one grey "Running tool" line
    // never could, and two renderings of the same event read as two calls.
    "run.continuing": {
      label: t("chatActivityContinuingAfterTool"),
      state: "active",
    },
    "run.completed": {
      label: t("chatActivityResponseComplete"),
      state: "complete",
    },
    "run.cancelled": {
      label: t("chatActivityResponseStopped"),
      state: "error",
    },
    "run.failed": {
      label: t("chatActivityResponseFailed"),
      state: "error",
    },
  };
  const definition = definitions[event.type];
  return definition === undefined
    ? undefined
    : {
        id: `${event.runId}:${event.type}`,
        label: definition.label,
        state: definition.state,
        type: event.type,
      };
}

export function rememberAppliedEvent(
  eventId: string,
  ids: Set<string>,
  order: string[],
): void {
  ids.add(eventId);
  order.push(eventId);
  if (order.length <= 256) return;
  const expired = order.shift();
  if (expired !== undefined) ids.delete(expired);
}
