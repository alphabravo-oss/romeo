import { describe, expect, it } from "vitest";

import {
  applyBrowserSecurityHeaders,
  contentSecurityPolicy,
  createCspNonce,
} from "./security-headers";

describe("browser security headers", () => {
  it("creates a fresh high-entropy nonce", () => {
    const first = createCspNonce();
    const second = createCspNonce();
    expect(first).toMatch(/^[a-f0-9]{36}$/);
    expect(second).not.toBe(first);
  });

  it("allows only nonce-bearing scripts in production", () => {
    const policy = contentSecurityPolicy("abc123");
    const scriptDirective = policy
      .split("; ")
      .find((directive) => directive.startsWith("script-src"));
    expect(scriptDirective).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    );
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("adds the complete browser hardening header set", () => {
    const headers = new Headers();
    applyBrowserSecurityHeaders(headers, "abc123");
    expect(headers.get("content-security-policy")).toContain("nonce-abc123");
    expect(headers.get("permissions-policy")).toBe(
      "camera=(), geolocation=(), microphone=()",
    );
    expect(headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });
});
