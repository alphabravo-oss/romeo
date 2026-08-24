import type { ServerTableSavedViewRecord } from "@romeo/core";
import { describe, expect, it } from "vitest";

import { PgServerTableRepository } from "./server-table-repository";

const now = "2026-08-23T12:00:00.000Z";

describe("PgServerTableRepository", () => {
  it("lists and reads normalized saved views", async () => {
    await expect(
      repository([
        [row(), row({ id: "view_2", visibility: "workspace" })],
      ]).listServerTableSavedViews({
        orgId: "org_default",
        workspaceId: "workspace_default",
        resource: "providers",
        ownerUserId: "user_dev_admin",
      }),
    ).resolves.toMatchObject([
      { id: "view_1", visibility: "private" },
      { id: "view_2", visibility: "workspace" },
    ]);
    await expect(
      repository([[row()]]).getServerTableSavedView("org_default", "view_1"),
    ).resolves.toMatchObject({ id: "view_1" });
    await expect(
      repository([[]]).getServerTableSavedView("org_default", "missing"),
    ).resolves.toBeUndefined();
  });

  it("creates and updates views with optimistic and unique-name fencing", async () => {
    const view = record();
    await expect(
      repository([[], [], [row()]]).writeServerTableSavedView({ view }),
    ).resolves.toMatchObject({ outcome: "stored", view: { id: view.id } });
    await expect(
      repository([
        [row()],
        [],
        [row({ version: 2 })],
      ]).writeServerTableSavedView({
        view: { ...view, version: 2 },
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({ outcome: "stored", view: { version: 2 } });
    await expect(
      repository([[row()]]).writeServerTableSavedView({
        view,
        expectedVersion: 9,
      }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      repository([[], [{ id: "another" }]]).writeServerTableSavedView({ view }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      repository([[], [], []]).writeServerTableSavedView({ view }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      repository([
        [],
        [],
        [],
        [row({ isDefault: true })],
      ]).writeServerTableSavedView({ view: { ...view, isDefault: true } }),
    ).resolves.toMatchObject({ outcome: "stored", view: { isDefault: true } });
  });

  it("soft-deletes views idempotently and rejects stale or foreign writes", async () => {
    const input = deleteInput();
    await expect(
      repository([[]]).deleteServerTableSavedView(input),
    ).resolves.toEqual({ outcome: "not_found" });
    await expect(
      repository([[row({ ownerUserId: "other" })]]).deleteServerTableSavedView(
        input,
      ),
    ).resolves.toEqual({ outcome: "not_found" });
    const deleted = row({
      deletedAt: new Date(now),
      deleteTokenHash: "token_hash",
      deleteTokenExpiresAt: new Date("2026-08-23T13:00:00.000Z"),
      deletedWasDefault: false,
    });
    await expect(
      repository([[deleted]]).deleteServerTableSavedView(input),
    ).resolves.toMatchObject({ outcome: "already_deleted" });
    await expect(
      repository([[deleted]]).deleteServerTableSavedView({
        ...input,
        deleteTokenHash: "different",
      }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      repository([[row()]]).deleteServerTableSavedView({
        ...input,
        expectedVersion: 9,
      }),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      repository([[row()], [deleted]]).deleteServerTableSavedView(input),
    ).resolves.toMatchObject({ outcome: "deleted", view: { deletedAt: now } });
    await expect(
      repository([[row()], []]).deleteServerTableSavedView(input),
    ).resolves.toEqual({ outcome: "conflict" });
  });

  it("restores only an owned, unexpired, conflict-free tombstone", async () => {
    const input = restoreInput();
    await expect(
      repository([[]]).restoreServerTableSavedView(input),
    ).resolves.toEqual({ outcome: "not_found" });
    await expect(
      repository([[row({ ownerUserId: "other" })]]).restoreServerTableSavedView(
        input,
      ),
    ).resolves.toEqual({ outcome: "not_found" });
    await expect(
      repository([[row()]]).restoreServerTableSavedView(input),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      repository([
        [deletedRow({ deleteTokenHash: "other" })],
      ]).restoreServerTableSavedView(input),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      repository([
        [
          deletedRow({
            deleteTokenExpiresAt: new Date("2026-08-23T11:00:00.000Z"),
          }),
        ],
      ]).restoreServerTableSavedView(input),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      repository([
        [deletedRow()],
        [{ id: "name_conflict" }],
      ]).restoreServerTableSavedView(input),
    ).resolves.toEqual({ outcome: "conflict" });
    await expect(
      repository([
        [deletedRow()],
        [],
        [],
        [row({ version: 3, isDefault: true })],
      ]).restoreServerTableSavedView(input),
    ).resolves.toMatchObject({
      outcome: "restored",
      view: { isDefault: true },
    });
    await expect(
      repository([
        [deletedRow({ deletedWasDefault: false })],
        [],
        [],
      ]).restoreServerTableSavedView(input),
    ).resolves.toEqual({ outcome: "conflict" });
  });
});

function record(
  overrides: Partial<ServerTableSavedViewRecord> = {},
): ServerTableSavedViewRecord {
  return {
    id: "view_1",
    orgId: "org_default",
    workspaceId: "workspace_default",
    ownerUserId: "user_dev_admin",
    resource: "providers",
    name: "My providers",
    nameNormalized: "my providers",
    query: { search: "openai", sort: [], filters: [], pageSize: 50 },
    presentation: { columnVisibility: { name: true }, density: "compact" },
    visibility: "private",
    isDefault: false,
    schemaVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    ...record(),
    parentId: null,
    parentScopeKey: "",
    deleteTokenHash: null,
    deleteTokenExpiresAt: null,
    deletedWasDefault: null,
    deletedAt: null,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    ...overrides,
  };
}

function deletedRow(overrides: Record<string, unknown> = {}) {
  return row({
    deletedAt: new Date(now),
    deleteTokenHash: "token_hash",
    deleteTokenExpiresAt: new Date("2026-08-23T13:00:00.000Z"),
    deletedWasDefault: true,
    isDefault: false,
    version: 2,
    ...overrides,
  });
}

function deleteInput() {
  return {
    orgId: "org_default",
    viewId: "view_1",
    ownerUserId: "user_dev_admin",
    expectedVersion: 1,
    deletedAt: now,
    deleteTokenHash: "token_hash",
    deleteTokenExpiresAt: "2026-08-23T13:00:00.000Z",
  };
}

function restoreInput() {
  return {
    orgId: "org_default",
    viewId: "view_1",
    ownerUserId: "user_dev_admin",
    deleteTokenHash: "token_hash",
    expectedVersion: 2,
    restoredAt: "2026-08-23T12:30:00.000Z",
  };
}

function repository(results: unknown[][]) {
  return new PgServerTableRepository(chainDatabase(results) as never);
}

function chainDatabase(results: unknown[][]) {
  const pending = [...results];
  const database: Record<string, unknown> = {};
  const query = () => {
    const result = pending.shift() ?? [];
    const chain = new Proxy(
      {},
      {
        get: (_target, property) =>
          property === "then"
            ? (resolve: (value: unknown) => unknown) => resolve(result)
            : () => chain,
      },
    );
    return chain;
  };
  database.insert = query;
  database.select = query;
  database.update = query;
  return database;
}
