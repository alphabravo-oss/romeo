import type { RunEvent } from "../features/runs";
import type { MessageKey } from "./i18n";
import { activityFromEvent, reasoningSeconds } from "./run-registry-events";
import type { ChatCitation, TrackedRun } from "./run-registry-types";
import { reduceToolCalls } from "./run-tool-calls";

export function consumeRunDetail(
  event: RunEvent,
  chatId: string,
  runId: string,
  t: (key: MessageKey) => string,
  registry: Map<string, TrackedRun>,
  publishRun: (
    chatId: string,
    runId: string,
    patch: Partial<TrackedRun>,
  ) => void,
  notifyListeners: () => void,
): void {
  if (
    event.type === "message.reasoning" ||
    event.type === "message.started" ||
    event.type === "reasoning.summary.delta" ||
    event.type === "reasoning.summary.completed"
  )
    return trackReasoning(
      event,
      chatId,
      runId,
      registry,
      publishRun,
      notifyListeners,
    );
  const toolRun = registry.get(chatId);
  if (toolRun !== undefined && toolRun.runId === runId) {
    const toolCalls = reduceToolCalls(toolRun.toolCalls, event);
    if (toolCalls !== toolRun.toolCalls)
      publishRun(chatId, runId, { toolCalls });
  }
  if (event.type === "retrieval.completed") {
    const eventCitations = (event.data as { citations?: unknown }).citations;
    if (Array.isArray(eventCitations)) {
      publishRun(chatId, runId, {
        citations: eventCitations.flatMap((item) => {
          const citation = item as Partial<ChatCitation>;
          return typeof citation.chunkId === "string" &&
            typeof citation.documentId === "string" &&
            typeof citation.title === "string"
            ? [citation as ChatCitation]
            : [];
        }),
      });
    }
  }
  const activity = activityFromEvent(event, t);
  if (activity === undefined) return;
  const current = registry.get(chatId);
  if (current === undefined || current.runId !== runId) return;
  publishRun(chatId, runId, {
    activities: [
      ...current.activities.filter((item) => item.id !== activity.id),
      activity,
    ],
  });
}

// Only DLP-governed provider-safe summaries may enter UI state. Legacy or
// unclassified reasoning is ignored even if a stale server replays it.
function trackReasoning(
  event: RunEvent,
  chatId: string,
  runId: string,
  registry: Map<string, TrackedRun>,
  publishRun: (
    chatId: string,
    runId: string,
    patch: Partial<TrackedRun>,
  ) => void,
  notifyListeners: () => void,
): void {
  const current = registry.get(chatId);
  if (current === undefined || current.runId !== runId) return;
  if (event.type === "message.started") {
    if (
      current.reasoning === undefined &&
      current.reasoningStartedAt === undefined
    )
      return;
    const restarted = { ...current };
    delete restarted.reasoning;
    delete restarted.reasoningStartedAt;
    registry.set(chatId, restarted);
    notifyListeners();
    return;
  }
  if (event.type === "message.reasoning") return;
  const data = event.data as {
    classification?: unknown;
    contentPolicyApplied?: unknown;
    durationMs?: unknown;
    status?: unknown;
    text?: unknown;
  };
  if (event.type === "reasoning.summary.completed") {
    if (
      data.classification !== "provider_safe_summary" ||
      data.status !== "completed"
    ) {
      if (current.reasoning === undefined) return;
      const discarded = { ...current };
      delete discarded.reasoning;
      delete discarded.reasoningStartedAt;
      registry.set(chatId, discarded);
      notifyListeners();
      return;
    }
    if (current.reasoning === undefined) return;
    const seconds =
      typeof data.durationMs === "number" &&
      Number.isSafeInteger(data.durationMs) &&
      data.durationMs >= 0 &&
      data.durationMs <= 86_400_000
        ? Math.round(data.durationMs / 1_000)
        : current.reasoning.seconds;
    publishRun(chatId, runId, {
      reasoning: { ...current.reasoning, completed: true, seconds },
    });
    return;
  }
  if (
    data.classification !== "provider_safe_summary" ||
    data.contentPolicyApplied !== true ||
    typeof data.text !== "string"
  )
    return;
  const startedAt = current.reasoningStartedAt ?? event.createdAt;
  const text = (current.reasoning?.text ?? "") + data.text.slice(0, 4_096);
  publishRun(chatId, runId, {
    reasoning: {
      completed: false,
      seconds: reasoningSeconds(startedAt, event.createdAt),
      text: text.slice(0, 20_000),
    },
    reasoningStartedAt: startedAt,
  });
}
