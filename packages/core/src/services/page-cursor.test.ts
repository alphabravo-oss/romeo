import { describe, expect, it } from "vitest";

import {
  createPageCursorCodec,
  derivePageCursorSecret,
  InvalidPageCursorError,
} from "./page-cursor";

const currentSecret = "c".repeat(32);
const previousSecret = "p".repeat(32);

function position(
  value: unknown,
): { createdAt: string; id: string } | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("createdAt" in value) ||
    !("id" in value) ||
    typeof value.createdAt !== "string" ||
    typeof value.id !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    value.id.length < 1
  ) {
    return undefined;
  }
  return { createdAt: value.createdAt, id: value.id };
}

describe("page cursor codec", () => {
  it("round-trips a keyset position bound to canonical filter and sort", () => {
    const codec = createPageCursorCodec({
      resource: "audit.events",
      secrets: [currentSecret],
      now: () => Date.parse("2026-08-14T12:00:00.000Z"),
      maxAgeSeconds: 300,
    });
    const token = codec.encode({
      filter: { orgId: "org_1", outcome: "failure" },
      sort: [{ direction: "desc", field: "createdAt" }],
      position: { createdAt: "2026-08-14T11:59:00.000Z", id: "audit_2" },
    });

    expect(
      codec.decode(
        token,
        {
          filter: { outcome: "failure", orgId: "org_1" },
          sort: [{ field: "createdAt", direction: "desc" }],
        },
        position,
      ),
    ).toEqual({ createdAt: "2026-08-14T11:59:00.000Z", id: "audit_2" });
    expect(token).not.toContain("org_1");
    expect(token).not.toContain("audit_2");
  });

  it.each([
    ["filter", { filter: { orgId: "org_2" }, sort: [] }],
    ["sort", { filter: { orgId: "org_1" }, sort: ["id"] }],
  ])("rejects a cursor reused with a different %s", (_name, context) => {
    const codec = createPageCursorCodec({
      resource: "users",
      secrets: [currentSecret],
    });
    const token = codec.encode({
      filter: { orgId: "org_1" },
      sort: [],
      position: { createdAt: "2026-08-14T11:59:00.000Z", id: "user_1" },
    });
    expect(() => codec.decode(token, context, position)).toThrow(
      InvalidPageCursorError,
    );
  });

  it("rejects tampering, cross-resource replay, malformed positions, and oversized input", () => {
    const users = createPageCursorCodec({
      resource: "users",
      secrets: [currentSecret],
    });
    const sessions = createPageCursorCodec({
      resource: "sessions",
      secrets: [currentSecret],
    });
    const context = { filter: { orgId: "org_1" }, sort: [] };
    const token = users.encode({ ...context, position: { id: "user_1" } });
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(() => users.decode(tampered, context, position)).toThrow(
      InvalidPageCursorError,
    );
    expect(() => sessions.decode(token, context, position)).toThrow(
      InvalidPageCursorError,
    );
    expect(() => users.decode(token, context, position)).toThrow(
      InvalidPageCursorError,
    );
    expect(() => users.decode("x".repeat(2_001), context, position)).toThrow(
      InvalidPageCursorError,
    );
  });

  it("expires cursors and rejects tokens issued implausibly in the future", () => {
    let now = Date.parse("2026-08-14T12:00:00.000Z");
    const codec = createPageCursorCodec({
      resource: "usage.events",
      secrets: [currentSecret],
      maxAgeSeconds: 60,
      now: () => now,
    });
    const context = { filter: { orgId: "org_1" }, sort: [] };
    const token = codec.encode({
      ...context,
      position: { createdAt: "2026-08-14T11:00:00.000Z", id: "usage_1" },
    });
    now += 61_000;
    expect(() => codec.decode(token, context, position)).toThrow(
      InvalidPageCursorError,
    );

    now -= 180_000;
    expect(() => codec.decode(token, context, position)).toThrow(
      InvalidPageCursorError,
    );
  });

  it("accepts a previous rotation key while signing new cursors with the current key", () => {
    const oldCodec = createPageCursorCodec({
      resource: "webhook.deliveries",
      secrets: [previousSecret],
    });
    const rotatedCodec = createPageCursorCodec({
      resource: "webhook.deliveries",
      secrets: [currentSecret, previousSecret],
    });
    const currentOnly = createPageCursorCodec({
      resource: "webhook.deliveries",
      secrets: [currentSecret],
    });
    const context = { filter: { orgId: "org_1" }, sort: [] };
    const oldToken = oldCodec.encode({
      ...context,
      position: { createdAt: "2026-08-14T11:00:00.000Z", id: "delivery_1" },
    });
    const newToken = rotatedCodec.encode({
      ...context,
      position: { createdAt: "2026-08-14T11:00:00.000Z", id: "delivery_2" },
    });

    expect(rotatedCodec.decode(oldToken, context, position).id).toBe(
      "delivery_1",
    );
    expect(currentOnly.decode(newToken, context, position).id).toBe(
      "delivery_2",
    );
  });

  it("fails closed for weak configuration and non-JSON values", () => {
    expect(() =>
      createPageCursorCodec({ resource: "users", secrets: ["weak"] }),
    ).toThrow(TypeError);
    const codec = createPageCursorCodec({
      resource: "users",
      secrets: [currentSecret],
    });
    expect(() =>
      codec.encode({ filter: {}, sort: [], position: { id: BigInt(1) } }),
    ).toThrow(InvalidPageCursorError);
  });

  it("derives purpose-separated cursor keys from an application secret", () => {
    const first = derivePageCursorSecret("application-secret", "audit.events");
    const second = derivePageCursorSecret(
      "application-secret",
      "webhook.deliveries",
    );
    expect(first).toHaveLength(64);
    expect(first).not.toBe(second);
    expect(first).not.toContain("application-secret");
  });
});
