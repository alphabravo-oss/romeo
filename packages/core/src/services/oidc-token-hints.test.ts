import { describe, expect, it } from "vitest";

import {
  audienceIncludes,
  tokenKeyId,
  unverifiedJwtAudience,
  unverifiedJwtIssuer,
} from "./oidc-token-hints";

function token(header: unknown, payload: unknown): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode(header)}.${encode(payload)}.signature`;
}

describe("OIDC unverified token hints", () => {
  it("extracts bounded routing and key-selection hints", () => {
    const value = token(
      { kid: "key-1" },
      { aud: ["romeo", "secondary"], iss: "https://idp.prod.invalid" },
    );

    expect(tokenKeyId(value)).toBe("key-1");
    expect(unverifiedJwtIssuer(value)).toBe("https://idp.prod.invalid");
    expect(unverifiedJwtAudience(value)).toEqual(["romeo", "secondary"]);
    expect(audienceIncludes(unverifiedJwtAudience(value), "romeo")).toBe(true);
  });

  it("fails closed for malformed, empty, and oversized hints", () => {
    expect(tokenKeyId("not-a-jwt")).toBeUndefined();
    expect(unverifiedJwtIssuer("not-a-jwt")).toBeUndefined();
    expect(unverifiedJwtAudience("not-a-jwt")).toEqual([]);
    expect(
      tokenKeyId(token({ kid: "k".repeat(301) }, { aud: 42, iss: "" })),
    ).toBeUndefined();
    expect(
      unverifiedJwtAudience(token({}, { aud: ["romeo", 42, ""] })),
    ).toEqual(["romeo"]);
    expect(audienceIncludes(["romeo"], "")).toBe(false);
  });
});
