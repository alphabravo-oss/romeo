import { describe, expect, it } from "vitest";

import {
  readPendingTableExport,
  serverTableExportStorageKey,
  writePendingTableExport,
} from "./server-table-export-storage";

describe("pending table export storage", () => {
  it("isolates a pending job by workspace, resource, and parent scope", () => {
    const storage = memoryStorage();
    const first = serverTableExportStorageKey({
      workspaceId: "workspace_1",
      resource: "usage_events",
      parentId: "provider_1",
    });
    const second = serverTableExportStorageKey({
      workspaceId: "workspace_1",
      resource: "usage_events",
      parentId: "provider_2",
    });
    expect(writePendingTableExport(first, "export_job_1", storage)).toBe(true);
    expect(readPendingTableExport(first, storage)).toBe("export_job_1");
    expect(readPendingTableExport(second, storage)).toBeUndefined();
    expect(writePendingTableExport(first, undefined, storage)).toBe(true);
    expect(readPendingTableExport(first, storage)).toBeUndefined();
  });

  it("fails closed when storage throws or contains an invalid identifier", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(readPendingTableExport("key", unavailable)).toBeUndefined();
    const storage = memoryStorage();
    storage.setItem("key", "../not-an-export");
    expect(readPendingTableExport("key", storage)).toBeUndefined();
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
