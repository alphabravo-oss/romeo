import { describe, expect, it } from "vitest";

import { WorkerBrokerTokenCodec } from "./worker-broker-token";

const oldSecret = "old-broker-secret-".repeat(4);
const currentSecret = "current-broker-secret-".repeat(4);
const nextSecret = "next-broker-secret-".repeat(4);

const payload = {
  attempt: 2,
  audience: "tool_dispatch" as const,
  expiresAt: "2030-01-01T00:05:00.000Z",
  fence: 2,
  orgId: "org_a",
  version: 1 as const,
  workerId: "worker-a",
  workId: "job_a",
};

describe("WorkerBrokerTokenCodec", () => {
  it("accepts current and previous bearer credentials without cross-audience access", () => {
    const codec = new WorkerBrokerTokenCodec({
      current: currentSecret,
      previous: oldSecret,
    });
    expect(() =>
      codec.authenticateBearer(`Bearer ${currentSecret}`),
    ).not.toThrow();
    expect(() => codec.authenticateBearer(`Bearer ${oldSecret}`)).not.toThrow();
    expect(() => codec.authenticateBearer(`Bearer ${nextSecret}`)).toThrow(
      "Worker broker authentication failed.",
    );

    const token = codec.issue(payload);
    expect(
      codec.verify(
        token,
        { audience: "tool_dispatch", workerId: "worker-a" },
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    ).toEqual(payload);
    expect(() =>
      codec.verify(
        token,
        { audience: "browser_automation", workerId: "worker-a" },
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    ).toThrow("not valid for this audience and worker");
  });

  it("supports one-step rotation and rejects a removed previous key", () => {
    const oldCodec = new WorkerBrokerTokenCodec({ current: oldSecret });
    const oldToken = oldCodec.issue(payload);
    const rotating = new WorkerBrokerTokenCodec({
      current: currentSecret,
      previous: oldSecret,
    });
    expect(() =>
      rotating.verify(
        oldToken,
        { audience: "tool_dispatch", workerId: "worker-a" },
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    ).not.toThrow();
    const afterRevocation = new WorkerBrokerTokenCodec({
      current: currentSecret,
    });
    expect(() =>
      afterRevocation.verify(
        oldToken,
        { audience: "tool_dispatch", workerId: "worker-a" },
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    ).toThrow("worker claim is invalid");
  });

  it("rejects expiry, worker spoofing, ciphertext changes, and weak keys", () => {
    const codec = new WorkerBrokerTokenCodec({ current: currentSecret });
    const token = codec.issue(payload);
    expect(() =>
      codec.verify(
        token,
        { audience: "tool_dispatch", workerId: "worker-b" },
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    ).toThrow("not valid for this audience and worker");
    expect(() =>
      codec.verify(
        token,
        { audience: "tool_dispatch", workerId: "worker-a" },
        new Date("2030-01-01T00:06:00.000Z"),
      ),
    ).toThrow("worker claim has expired");
    expect(() =>
      codec.verify(
        tamper(token),
        { audience: "tool_dispatch", workerId: "worker-a" },
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    ).toThrow("worker claim is invalid");
    expect(() => new WorkerBrokerTokenCodec({ current: "weak" })).toThrow(
      "credential_too_short",
    );
  });
});

function tamper(token: string): string {
  const parts = token.split(".");
  const ciphertext = parts[2]!;
  parts[2] = `${ciphertext[0] === "a" ? "b" : "a"}${ciphertext.slice(1)}`;
  return parts.join(".");
}
