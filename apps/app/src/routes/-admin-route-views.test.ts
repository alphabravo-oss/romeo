import { describe, expect, it } from "vitest";

import {
  resolveAdminAccessView,
  resolveAdminProviderView,
  resolveAdminUsageView,
} from "./-admin-route-views";

describe("admin route view resolution", () => {
  it("normalizes legacy and invalid provider views", () => {
    expect(resolveAdminProviderView("models")).toBe("base-models");
    expect(resolveAdminProviderView("curated")).toBe("curated");
    expect(resolveAdminProviderView("unknown")).toBe("providers");
  });

  it("keeps each section within its own supported view set", () => {
    expect(resolveAdminUsageView("quotas")).toBe("quotas");
    expect(resolveAdminUsageView("tools")).toBe("consumption");
    expect(resolveAdminAccessView("service-accounts")).toBe("service-accounts");
    expect(resolveAdminAccessView("imports")).toBe("keys");
  });
});
