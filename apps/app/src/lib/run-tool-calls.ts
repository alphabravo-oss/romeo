import type { RunEvent } from "../features/runs";

// Everything a tool card shows already ships on the run events; nothing new
// goes on the wire. Run-event data is serialised straight to every `runs:read`
// subscriber, and the redaction boundary deliberately carries argument and
// result KEYS only -- never their values. A card therefore reports which
// arguments a tool was given and which fields came back, plus risk, approval
// and timing, and never what was in them.
export interface ChatToolCall {
  approvalRequired: boolean;
  argumentKeys: string[];
  durationMs: number | undefined;
  errorCode: string | undefined;
  id: string;
  name: string;
  outputKeys: string[];
  riskLevel: string | undefined;
  startedAt: string | undefined;
  state: "awaiting_approval" | "completed" | "failed" | "requested" | "running";
}

const stateByEvent: Partial<Record<RunEvent["type"], ChatToolCall["state"]>> = {
  "tool.approval_required": "awaiting_approval",
  "tool.completed": "completed",
  "tool.failed": "failed",
  "tool.requested": "requested",
  "tool.started": "running",
};

/**
 * Folds one run event into the tool cards for a turn. Returns `previous`
 * unchanged for anything that is not a tool event, so callers can hand it every
 * event and compare identities.
 *
 * The provider-side event names the tool `name`; the core lifecycle events name
 * it `toolId`. They are the same string -- run-streaming-execution-service
 * dispatches with `toolId: toolCall.name` -- which is what lets the two
 * families pair without a shared call id.
 *
 * ponytail: a lifecycle event attaches to the oldest still-open call of the
 * same name, so two calls to one tool running concurrently inside a single turn
 * can pair to the wrong card if their results come back out of order (the
 * fields shown are per-call, so the mistake is visible as swapped durations,
 * never as a crash). Upgrade path: thread the
 * already-hashed `providerCallIdHash` through ToolExecutionOptions into
 * appendToolRunEvent and pair on it.
 */
export function reduceToolCalls(
  previous: ChatToolCall[],
  event: RunEvent,
): ChatToolCall[] {
  const state = stateByEvent[event.type];
  if (state === undefined) return previous;
  const data = event.data as Record<string, unknown>;
  const name = text(data.name) ?? text(data.toolId);
  if (name === undefined) return previous;

  // A request always opens a card: it is the first the client hears of a call,
  // and the lifecycle events that follow attach to it.
  if (event.type === "tool.requested") {
    return [...previous, applied(opened(previous, event, name), event, data)];
  }
  // First still-open call of that name, so a tool used twice in one turn pairs
  // its second result to its second card rather than overwriting the first.
  const index = previous.findIndex(
    (call) =>
      call.name === name &&
      call.state !== "completed" &&
      call.state !== "failed",
  );
  if (index === -1) {
    return [...previous, applied(opened(previous, event, name), event, data)];
  }
  return previous.map((call, position) =>
    position === index ? applied(call, event, data) : call,
  );
}

function opened(
  previous: ChatToolCall[],
  event: RunEvent,
  name: string,
): ChatToolCall {
  const ordinal = previous.filter((call) => call.name === name).length;
  return {
    approvalRequired: false,
    argumentKeys: [],
    durationMs: undefined,
    errorCode: undefined,
    id: `${event.runId}:${name}:${ordinal}`,
    name,
    outputKeys: [],
    riskLevel: undefined,
    startedAt: undefined,
    state: "requested",
  };
}

function applied(
  call: ChatToolCall,
  event: RunEvent,
  data: Record<string, unknown>,
): ChatToolCall {
  const state = stateByEvent[event.type] ?? call.state;
  // The clock starts at whichever lifecycle event arrived first: an approval
  // gate replaces tool.started rather than following it, and the wait for a
  // human is part of how long the reader waited.
  const startedAt =
    call.startedAt ?? (state === "requested" ? undefined : event.createdAt);
  const finished = state === "completed" || state === "failed";
  return {
    approvalRequired: data.approvalRequired === true || call.approvalRequired,
    argumentKeys:
      keys(data.argumentKeys) ?? keys(data.inputKeys) ?? call.argumentKeys,
    durationMs: finished
      ? elapsed(startedAt, event.createdAt)
      : call.durationMs,
    errorCode: text(data.errorCode) ?? call.errorCode,
    id: call.id,
    name: call.name,
    outputKeys: keys(data.outputKeys) ?? call.outputKeys,
    riskLevel: text(data.riskLevel) ?? call.riskLevel,
    startedAt,
    state,
  };
}

function elapsed(
  startedAt: string | undefined,
  finishedAt: string,
): number | undefined {
  if (startedAt === undefined) return undefined;
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function keys(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item) => typeof item === "string");
  return strings.length === 0 ? undefined : strings;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
