import { describe, expect, it } from "vitest";

import {
  applyBrowserSecurityHeaders,
  contentSecurityPolicy,
  createCspNonce,
  objectStoreOriginFromEnv,
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

  it("does not let the page connect to arbitrary origins", () => {
    const directive = (policy: string, name: string) =>
      policy.split("; ").find((entry) => entry.startsWith(`${name} `));
    const production = contentSecurityPolicy("abc123");
    expect(directive(production, "connect-src")).toBe(
      "connect-src 'self' blob:",
    );
    const withObjectStore = contentSecurityPolicy("abc123", {
      objectStoreOrigin: "https://objects.example",
    });
    expect(directive(withObjectStore, "connect-src")).toBe(
      "connect-src 'self' blob: https://objects.example",
    );
  });

  it("derives the object-store origin only for the S3 driver", () => {
    expect(
      objectStoreOriginFromEnv({
        OBJECT_STORE_DRIVER: "s3",
        S3_ENDPOINT: "https://objects.example:9000/bucket",
      }),
    ).toBe("https://objects.example:9000");
    expect(
      objectStoreOriginFromEnv({
        OBJECT_STORE_DRIVER: "memory",
        S3_ENDPOINT: "https://objects.example",
      }),
    ).toBeUndefined();
    expect(
      objectStoreOriginFromEnv({
        OBJECT_STORE_DRIVER: "s3",
        S3_ENDPOINT: "javascript:alert(1)",
      }),
    ).toBeUndefined();
  });
});
