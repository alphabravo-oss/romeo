import { describe, expect, it } from "vitest";

import { splitProviderZones } from "./auth-provider-zones";

const row = (
  id: string,
  configured: boolean,
  enabled: boolean,
  status: "implemented" | "planned" = "implemented",
) => ({ id, configured, enabled, status });

describe("provider zones", () => {
  it("puts configured providers in the active zone even when switched off", () => {
    const zones = splitProviderZones([row("okta", true, false)]);
    expect(zones.active.map((entry) => entry.id)).toEqual(["okta"]);
    expect(zones.available).toHaveLength(0);
  });

  it("puts enabled providers in the active zone even when not yet configured", () => {
    const zones = splitProviderZones([row("local", false, true)]);
    expect(zones.active.map((entry) => entry.id)).toEqual(["local"]);
  });

  it("puts untouched implemented providers in the available zone", () => {
    const zones = splitProviderZones([row("keycloak", false, false)]);
    expect(zones.available.map((entry) => entry.id)).toEqual(["keycloak"]);
    expect(zones.active).toHaveLength(0);
  });

  it("separates planned providers so they are never offered as claimable", () => {
    const zones = splitProviderZones([row("saml", false, false, "planned")]);
    expect(zones.unavailable.map((entry) => entry.id)).toEqual(["saml"]);
    expect(zones.available).toHaveLength(0);
  });

  it("keeps a planned provider active if it was somehow already configured", () => {
    const zones = splitProviderZones([row("saml", true, false, "planned")]);
    expect(zones.active.map((entry) => entry.id)).toEqual(["saml"]);
    expect(zones.unavailable).toHaveLength(0);
  });

  it("preserves catalog order within each zone", () => {
    const zones = splitProviderZones([
      row("a", false, false),
      row("b", true, false),
      row("c", false, false),
      row("d", true, false),
    ]);
    expect(zones.active.map((entry) => entry.id)).toEqual(["b", "d"]);
    expect(zones.available.map((entry) => entry.id)).toEqual(["a", "c"]);
  });
});
