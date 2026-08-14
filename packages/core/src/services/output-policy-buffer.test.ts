import { describe, expect, it } from "vitest";

import {
  applyOutputPolicyBeforePersist,
  OutputPolicyBuffer,
} from "./output-policy-buffer";

const blockSsn = {
  credit_card: "disabled" as const,
  email_address: "disabled" as const,
  us_ssn: "block" as const,
  api_token: "disabled" as const,
};

describe("output policy buffer", () => {
  it("blocks a split detector match before persist or SSE", () => {
    const buffer = new OutputPolicyBuffer({
      mode: "rolling",
      detectors: blockSsn,
      lookbehindCharacters: 8,
    });
    const persisted: string[] = [];
    const emitted: string[] = [];
    const first = applyOutputPolicyBeforePersist({
      buffer,
      chunk: "078-",
      persist: (text) => persisted.push(text),
      emit: (text) => emitted.push(text),
    });
    expect(first.action).toBe("hold");
    expect(persisted).toEqual([]);
    expect(emitted).toEqual([]);
    const blocked = applyOutputPolicyBeforePersist({
      buffer,
      chunk: "05-1120 is private",
      persist: (text) => persisted.push(text),
      emit: (text) => emitted.push(text),
    });
    expect(blocked).toMatchObject({
      action: "block",
      code: "firewall_output_blocked",
      detectors: ["us_ssn"],
    });
    expect(persisted).toEqual([]);
    expect(emitted).toEqual([]);
    expect(buffer.persisted()).toBe("");
  });

  it("holds a strict buffer until finish and fails closed when policy is unreadable", () => {
    const buffer = new OutputPolicyBuffer({
      mode: "strict",
      detectors: blockSsn,
    });
    expect(buffer.consume("hello ")).toEqual({ action: "hold" });
    expect(buffer.finish()).toEqual({ action: "release", text: "hello " });

    const unavailable = new OutputPolicyBuffer({
      mode: "strict",
      detectors: {} as never,
      failClosed: true,
    });
    expect(unavailable.consume("x")).toMatchObject({
      action: "block",
      code: "content_policy_unavailable",
    });
  });
});
