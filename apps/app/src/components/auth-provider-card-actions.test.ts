import { describe, expect, it } from "vitest";

import {
  canDeprovisionProvider,
  canTestProvider,
} from "./auth-provider-card-actions";

describe("provider card actions", () => {
  it("allows testing local without allowing it to be deprovisioned", () => {
    const local = {
      id: "local",
      protocol: "local",
      status: "implemented",
    } as const;
    expect(canTestProvider(local)).toBe(true);
    expect(canDeprovisionProvider(local)).toBe(false);
  });

  it("allows testing implemented SAML providers", () => {
    expect(
      canTestProvider({
        id: "saml-enterprise",
        protocol: "saml",
        status: "implemented",
      }),
    ).toBe(true);
  });

  it("only allows deprovisioning implemented non-local OIDC providers", () => {
    expect(
      canDeprovisionProvider({
        id: "oidc-enterprise",
        protocol: "oidc",
        status: "implemented",
      }),
    ).toBe(true);
    expect(
      canDeprovisionProvider({
        id: "oidc-planned",
        protocol: "oidc",
        status: "planned",
      }),
    ).toBe(false);
  });
});
