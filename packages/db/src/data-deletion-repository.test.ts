import { describe, expect, it } from "vitest";

import { PgDataDeletionRepository } from "./data-deletion-repository";

const now = "2026-08-23T12:00:00.000Z";

describe("PgDataDeletionRepository", () => {
  it("plans file and knowledge deletion with authoritative counts", async () => {
    const file = {
      id: "file_1",
      workspaceId: "workspace_default",
      sizeBytes: 256,
      metadata: { uploadMode: "resumable_backend_composed", partCount: 3 },
    };
    await expect(
      repository([[file], [{ value: 2 }]]).getDataDeletionPlan(
        "org_default",
        "file_object",
        file.id,
      ),
    ).resolves.toMatchObject({
      resourceType: "file_object",
      counts: {
        fileObjects: 1,
        objectStoreObjects: 4,
        objectStoreBytes: 256,
        resourceGrants: 2,
      },
    });
    await expect(
      repository([[]]).getDataDeletionPlan(
        "org_default",
        "file_object",
        "missing",
      ),
    ).resolves.toBeUndefined();

    const source = {
      id: "source_1",
      workspaceId: "workspace_default",
      knowledgeBaseId: "kb_default",
      objectKey: "knowledge/source_1",
      sizeBytes: 512,
    };
    await expect(
      repository([
        [source],
        [{ value: 4 }],
        [{ value: 5 }],
      ]).getDataDeletionPlan("org_default", "knowledge_source", source.id),
    ).resolves.toMatchObject({
      knowledgeBaseId: "kb_default",
      counts: {
        knowledgeSources: 1,
        knowledgeChunks: 4,
        knowledgeEmbeddings: 5,
        objectStoreObjects: 1,
        objectStoreBytes: 512,
      },
    });
    await expect(
      repository([[]]).getDataDeletionPlan(
        "org_default",
        "knowledge_source",
        "missing",
      ),
    ).resolves.toBeUndefined();
    await expect(
      repository([]).getDataDeletionPlan(
        "org_default",
        "unsupported" as never,
        "resource",
      ),
    ).resolves.toBeUndefined();
  });

  it("plans chat deletion, including dependent rows and active legal holds", async () => {
    const results = chatContextResults({
      legalHoldUntil: new Date("2026-08-24T12:00:00.000Z"),
      legalHoldReason: new Date("2026-08-23T11:00:00.000Z"),
    });
    const plan = await repository(results).getDataDeletionPlan(
      "org_default",
      "chat",
      "chat_1",
      now,
    );
    expect(plan).toMatchObject({
      resourceType: "chat",
      legalHold: { until: "2026-08-24T12:00:00.000Z" },
      counts: {
        chats: 1,
        messages: 2,
        messageParts: 3,
        runs: 1,
        runSteps: 3,
        runEvents: 3,
        userNotifications: 1,
        notificationDeliveries: 3,
        runLinkedToolCalls: 3,
      },
    });
    await expect(
      repository([[]]).getDataDeletionPlan("org_default", "chat", "missing"),
    ).resolves.toBeUndefined();
  });

  it("deletes unheld chat and file graphs transactionally", async () => {
    const chatResults = chatContextResults({
      legalHoldUntil: null,
      legalHoldReason: null,
    });
    chatResults.push([]);
    await expect(
      repository(chatResults).deleteDataForResource(
        "org_default",
        "chat",
        "chat_1",
        now,
      ),
    ).resolves.toMatchObject({ resourceType: "chat" });

    const file = {
      id: "file_1",
      workspaceId: "workspace_default",
      sizeBytes: 10,
      metadata: {},
    };
    await expect(
      repository([
        [file],
        [{ value: 0 }],
        [{ value: 0 }],
        [],
        [],
        [],
      ]).deleteDataForResource("org_default", "file_object", file.id, now),
    ).resolves.toMatchObject({ resourceType: "file_object" });
    await expect(
      repository([[]]).deleteDataForResource(
        "org_default",
        "file_object",
        "missing",
      ),
    ).resolves.toBeUndefined();
    await expect(
      repository([]).deleteDataForResource(
        "org_default",
        "knowledge_source",
        "source_1",
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses chat deletion while a legal hold is active", async () => {
    await expect(
      repository(
        chatContextResults({
          legalHoldUntil: new Date("2026-08-24T12:00:00.000Z"),
          legalHoldReason: null,
        }),
      ).deleteDataForResource("org_default", "chat", "chat_1", now),
    ).rejects.toThrow("active legal hold");
  });
});

function chatContextResults(hold: {
  legalHoldUntil: Date | null;
  legalHoldReason: Date | null;
}): unknown[][] {
  return [
    [
      {
        id: "chat_1",
        workspaceId: "workspace_default",
        ...hold,
      },
    ],
    [{ id: "run_1" }],
    [{ id: "message_1" }, { id: "message_2" }],
    [{ id: "notification_1" }],
    ...Array.from({ length: 10 }, () => [{ value: 3 }]),
  ];
}

function repository(results: unknown[][]) {
  return new PgDataDeletionRepository(chainDatabase(results) as never);
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
  database.delete = query;
  database.select = query;
  database.update = query;
  database.transaction = (callback: (transaction: unknown) => unknown) =>
    callback(database);
  return database;
}
