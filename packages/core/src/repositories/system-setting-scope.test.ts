import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "./in-memory";

describe("system setting repository scope contract", () => {
  it("allows the same key in global and multiple tenant scopes without an oracle", async () => {
    const repository = new InMemoryRomeoRepository();
    const key = "shared-setting-name";
    await repository.upsertSystemSetting(setting(key, "global"), null);
    await repository.upsertSystemSetting(setting(key, "tenant-a"), "org_a");
    await repository.upsertSystemSetting(setting(key, "tenant-b"), "org_b");

    expect((await repository.getSystemSetting(key, null))?.value).toEqual({
      marker: "global",
    });
    expect((await repository.getSystemSetting(key, "org_a"))?.value).toEqual({
      marker: "tenant-a",
    });
    expect((await repository.getSystemSetting(key, "org_b"))?.value).toEqual({
      marker: "tenant-b",
    });
    expect(
      await repository.getSystemSetting("foreign-key", "org_a"),
    ).toBeUndefined();
    expect(await repository.listSystemSettings("org_a")).toHaveLength(1);
    expect(await repository.listSystemSettings("org_b")).toHaveLength(1);
    expect(await repository.listSystemSettings(null)).toHaveLength(1);
  });

  it("rejects a setting record whose declared tenant mismatches its write scope", async () => {
    const repository = new InMemoryRomeoRepository();

    await expect(
      repository.upsertSystemSetting(
        { ...setting("mismatch", "blocked"), orgId: "org_b" },
        "org_a",
      ),
    ).rejects.toThrow("system_setting_scope_mismatch");
    expect(
      await repository.getSystemSetting("mismatch", "org_a"),
    ).toBeUndefined();
    expect(
      await repository.getSystemSetting("mismatch", "org_b"),
    ).toBeUndefined();
  });
});

function setting(key: string, marker: string) {
  return {
    key,
    value: { marker },
    updatedAt: "2026-08-23T12:00:00.000Z",
  };
}
