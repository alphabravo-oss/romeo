import { describe, expect, it } from "vitest";

import {
  defaultTablePreferences,
  readTablePreferences,
  removeTablePreferences,
  tablePreferenceIdentity,
  tablePreferenceStorageKey,
  writeTablePreferences,
  type TablePreferenceStorage,
} from "./table-preferences";

describe("table view preferences", () => {
  it("builds stable route and ordered-column identities", () => {
    expect(
      tablePreferenceIdentity(["name", "status"], {
        pathname: "/admin",
        search: "?ignored=x&section=users&tab=active",
      }),
    ).toBe("/admin?section=users&tab=active|name,status");
  });

  it("restores valid preferences and discards removed columns", () => {
    const storage = memoryStorage();
    writeTablePreferences(
      "users",
      {
        columnVisibility: { email: false, removed: false },
        density: "compact",
        pageSize: 50,
      },
      storage,
    );
    expect(
      readTablePreferences("users", new Set(["email"]), 25, storage),
    ).toEqual({
      columnVisibility: { email: false },
      density: "compact",
      pageSize: 50,
    });
  });

  it.each(["{", '{"version":2}', '{"version":1,"pageSize":13}'])(
    "falls back for malformed or incompatible storage: %s",
    (raw) => {
      const storage = memoryStorage();
      storage.setItem(tablePreferenceStorageKey("users"), raw);
      expect(
        readTablePreferences("users", new Set(["email"]), 25, storage),
      ).toEqual(defaultTablePreferences(25));
    },
  );

  it("tolerates storage failures and supports reset", () => {
    const storage = memoryStorage();
    writeTablePreferences("users", defaultTablePreferences(), storage);
    removeTablePreferences("users", storage);
    expect(storage.getItem(tablePreferenceStorageKey("users"))).toBeNull();

    const blocked: TablePreferenceStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readTablePreferences("users", new Set(), 25, blocked)).toEqual(
      defaultTablePreferences(),
    );
    expect(() =>
      writeTablePreferences("users", defaultTablePreferences(), blocked),
    ).not.toThrow();
    expect(() => removeTablePreferences("users", blocked)).not.toThrow();
  });
});

function memoryStorage(): TablePreferenceStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
