import { describe, expect, it } from "vitest";

import type { RunEvent } from "../features/runs";
import { reduceToolCalls, type ChatToolCall } from "./run-tool-calls";

let sequence = 0;

function event(
  type: RunEvent["type"],
  data: Record<string, unknown>,
  second = 0,
): RunEvent {
  sequence += 1;
  return {
    id: `evt_${sequence}`,
    runId: "run_1",
    sequence,
    type,
    data,
    createdAt: `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
  };
}

function fold(events: RunEvent[]): ChatToolCall[] {
  return events.reduce<ChatToolCall[]>(
    (calls, item) => reduceToolCalls(calls, item),
    [],
  );
}

describe("reduceToolCalls", () => {
  it("pairs the provider request with the core lifecycle events by tool name", () => {
    const calls = fold([
      event("tool.requested", {
        name: "search_web",
        argumentKeys: ["query", "topK"],
      }),
      event("tool.started", { toolId: "search_web", riskLevel: "low" }, 1),
      event(
        "tool.completed",
        { toolId: "search_web", outputKeys: ["results"] },
        4,
      ),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      argumentKeys: ["query", "topK"],
      durationMs: 3_000,
      name: "search_web",
      outputKeys: ["results"],
      riskLevel: "low",
      state: "completed",
    });
  });

  it("keeps two uses of the same tool in one turn apart", () => {
    const calls = fold([
      event("tool.started", { toolId: "read_file" }, 1),
      event("tool.completed", { toolId: "read_file", outputKeys: ["a"] }, 2),
      event("tool.started", { toolId: "read_file" }, 3),
      event("tool.completed", { toolId: "read_file", outputKeys: ["b"] }, 9),
    ]);
    expect(calls.map((call) => call.id)).toEqual([
      "run_1:read_file:0",
      "run_1:read_file:1",
    ]);
    expect(calls.map((call) => call.durationMs)).toEqual([1_000, 6_000]);
    expect(calls.map((call) => call.outputKeys)).toEqual([["a"], ["b"]]);
  });

  it("carries the error code and failed state", () => {
    const calls = fold([
      event("tool.started", { toolId: "send_email" }, 1),
      event(
        "tool.failed",
        { toolId: "send_email", errorCode: "tool_timeout" },
        3,
      ),
    ]);
    expect(calls[0]?.state).toBe("failed");
    expect(calls[0]?.errorCode).toBe("tool_timeout");
    expect(calls[0]?.durationMs).toBe(2_000);
  });

  // The approval gate arrives instead of tool.started, not after it, so the
  // wait for a human still has to start the card's clock.
  it("shows an approval gate as its own state and still times the call", () => {
    const calls = fold([
      event("tool.requested", { name: "delete_repo", argumentKeys: ["repo"] }),
      event(
        "tool.approval_required",
        { toolId: "delete_repo", approvalRequired: true, riskLevel: "high" },
        1,
      ),
    ]);
    expect(calls[0]).toMatchObject({
      approvalRequired: true,
      riskLevel: "high",
      state: "awaiting_approval",
    });
    expect(calls[0]?.startedAt).toBe("2026-01-01T00:00:01.000Z");
  });

  it("returns the same array for events that are not tool events", () => {
    const calls = fold([event("tool.started", { toolId: "search_web" })]);
    expect(reduceToolCalls(calls, event("message.delta", { text: "hi" }))).toBe(
      calls,
    );
    expect(reduceToolCalls(calls, event("run.completed", {}))).toBe(calls);
  });

  it("ignores a tool event with no tool name rather than opening an empty card", () => {
    expect(reduceToolCalls([], event("tool.started", {}))).toEqual([]);
  });
});
