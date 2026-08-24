import { describe, expect, it } from "vitest";

import { validateAdminSearch } from "./-admin-route-search";

describe("admin tab search validation", () => {
  it("retains supported deep-link tabs and rejects unknown values", () => {
    expect(
      validateAdminSearch({
        section: "rag",
        tab: "governance",
        subtab: "replay",
      }),
    ).toMatchObject({ tab: "governance", subtab: "replay" });
    expect(
      validateAdminSearch({ tab: "privileged-hidden", subtab: "removed" }),
    ).not.toHaveProperty("tab");
    expect(
      validateAdminSearch({ tab: "privileged-hidden", subtab: "removed" }),
    ).not.toHaveProperty("subtab");
  });
});
