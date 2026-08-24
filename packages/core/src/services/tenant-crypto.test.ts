import { describe, expect, it } from "vitest";

import {
  canSubstitutePlatformKey,
  openTenantEnvelope,
  revokeTenantKey,
  sealTenantEnvelope,
  type TenantKey,
} from "./tenant-crypto";

const wrapping = Buffer.from("customer-wrapping-material-32b!!");

describe("tenant crypto", () => {
  it("binds AAD to purpose/tenant/resource and refuses a swapped envelope", () => {
    const key = tenantKey();
    const sealed = sealTenantEnvelope({
      key,
      wrappingMaterial: wrapping,
      plaintext: Buffer.from("classified"),
      resourceId: "file_1",
    });
    expect(sealed.outcome).toBe("ok");
    if (sealed.outcome !== "ok" || sealed.envelope === undefined) {
      throw new Error("expected sealed tenant envelope");
    }
    const opened = openTenantEnvelope({
      key,
      wrappingMaterial: wrapping,
      envelope: sealed.envelope,
    });
    expect(opened.outcome).toBe("ok");
    if (opened.outcome !== "ok" || opened.plaintext === undefined) {
      throw new Error("expected opened tenant plaintext");
    }
    expect(opened.plaintext.toString()).toBe("classified");
    expect(
      openTenantEnvelope({
        key,
        wrappingMaterial: wrapping,
        envelope: { ...sealed.envelope, resourceId: "file_2" },
      }).outcome,
    ).toBe("unavailable");
  });

  it("never substitutes a platform key and fails closed after revoke", () => {
    const platform = tenantKey({ wrappingKeyId: "platform_secret_key" });
    expect(
      sealTenantEnvelope({
        key: platform,
        wrappingMaterial: wrapping,
        plaintext: Buffer.from("x"),
        resourceId: "file_1",
      }),
    ).toEqual({ outcome: "unavailable", code: "tenant_key_unavailable" });
    expect(canSubstitutePlatformKey(platform)).toBe(false);

    const revoked = revokeTenantKey(tenantKey());
    const sealedForRevoke = sealTenantEnvelope({
      key: tenantKey(),
      wrappingMaterial: wrapping,
      plaintext: Buffer.from("x"),
      resourceId: "file_1",
    });
    if (
      sealedForRevoke.outcome !== "ok" ||
      sealedForRevoke.envelope === undefined
    ) {
      throw new Error("expected sealed tenant envelope");
    }
    expect(
      openTenantEnvelope({
        key: revoked,
        wrappingMaterial: wrapping,
        envelope: sealedForRevoke.envelope,
      }),
    ).toEqual({ outcome: "unavailable", code: "tenant_key_revoked" });
  });
});

function tenantKey(overrides: Partial<TenantKey> = {}): TenantKey {
  return {
    version: 1,
    state: "active",
    purpose: "file",
    orgId: "org_default",
    wrappingKeyId: "kms_customer_1",
    ...overrides,
  };
}
