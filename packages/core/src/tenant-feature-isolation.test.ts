import { scopeValues, seededSubject, type AuthSubject } from "@romeo/auth";
import { MemoryObjectStore } from "@romeo/storage";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { createServices } from "./services";

const tenantBScope: AuthSubject = {
  id: "user_tenant_b",
  type: "user",
  orgId: "org_tenant_b",
  workspaceIds: ["workspace_tenant_b"],
  groupIds: [],
  scopes: [...scopeValues],
  isAdmin: false,
};

const sentinels = {
  file: "TENANT_A_FILE_SECRET_7391",
  memory: "TENANT_A_MEMORY_SECRET_4207",
  queue: "TENANT_A_QUEUE_SECRET_8813",
  run: "TENANT_A_RUN_SECRET_1649",
  search: "TENANT_A_SEARCH_SECRET_5521",
  share: "TENANT_A_SHARE_SECRET_9064",
  webSource: "TENANT_A_WEB_SOURCE_SECRET_3178",
} as const;

describe("tenant feature isolation", () => {
  it("does not expose queues, runs, files, search, shares, memories, or web sources across organizations", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const services = createServices(repository, { objectStore });
    const now = new Date().toISOString();

    await repository.createOrganization({
      id: tenantBScope.orgId,
      name: "Tenant B",
      slug: "tenant-b",
    });
    await repository.createWorkspace({
      id: tenantBScope.workspaceIds[0]!,
      orgId: tenantBScope.orgId,
      name: "Tenant B workspace",
      slug: "tenant-b",
    });
    await repository.createUser({
      id: tenantBScope.id,
      orgId: tenantBScope.orgId,
      email: "tenant-b@romeo.local",
      name: "Tenant B user",
    });

    await repository.createMessage({
      id: "message_tenant_a_search_sentinel",
      chatId: "chat_welcome",
      role: "user",
      content: sentinels.search,
      createdAt: now,
    });
    await repository.createQueuedChatTurn({
      id: "queued_turn_tenant_a_sentinel",
      orgId: seededSubject.orgId,
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      content: sentinels.queue,
      createdBy: seededSubject.id,
      principalId: seededSubject.id,
      principalType: seededSubject.type,
      scopeSnapshot: ["chats:write", "runs:create"],
      idempotencyKey: "tenant-a-queue-isolation",
      status: "queued",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createRun({
      id: sentinels.run,
      orgId: seededSubject.orgId,
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "completed",
      createdBy: seededSubject.id,
      createdAt: now,
      completedAt: now,
    });

    const privateFile = await services.files.create(seededSubject, {
      workspaceId: "workspace_default",
      fileName: `${sentinels.file}.txt`,
      mimeType: "text/plain",
      sizeBytes: sentinels.file.length,
      dataBase64: Buffer.from(sentinels.file).toString("base64"),
      purpose: "general",
    });
    const memory = await services.workspaceContent.create(
      seededSubject,
      "memory",
      {
        workspaceId: "workspace_default",
        scope: "workspace",
        title: sentinels.memory,
        body: sentinels.memory,
      },
    );
    const webSource = await services.files.create(seededSubject, {
      workspaceId: "workspace_default",
      fileName: `${sentinels.webSource}.html`,
      mimeType: "text/html",
      sizeBytes: sentinels.webSource.length,
      dataBase64: Buffer.from(sentinels.webSource).toString("base64"),
      purpose: "web_source",
      metadata: { sourceUrl: "https://tenant-a.invalid/private" },
    });
    await repository.createResourceGrant({
      id: "grant_tenant_a_share_sentinel",
      resourceType: "chat",
      resourceId: "chat_welcome",
      principalType: "group",
      principalId: sentinels.share,
      permission: "read",
    });

    const rejected: unknown[] = [];
    for (const operation of [
      () => services.runs.queuedForChat("chat_welcome", tenantBScope),
      () => services.runs.get(sentinels.run, tenantBScope),
      () => services.files.get(tenantBScope, privateFile.id),
      () => services.files.get(tenantBScope, webSource.id),
      () =>
        services.chats.search({
          workspaceId: "workspace_default",
          query: sentinels.search,
          subject: tenantBScope,
        }),
      () => services.collaboration.listChatShares(tenantBScope, "chat_welcome"),
      () =>
        services.workspaceContent.list(
          tenantBScope,
          "memory",
          "workspace_default",
        ),
    ]) {
      try {
        await operation();
        throw new Error("Expected cross-tenant operation to be rejected.");
      } catch (error) {
        rejected.push(error);
        expect(error).toMatchObject({
          code: expect.stringMatching(/forbidden|not_found/),
        });
      }
    }

    const [tenantBChats, tenantBFiles, tenantBMemories] = await Promise.all([
      services.chats.search({
        workspaceId: "workspace_tenant_b",
        query: "TENANT_A_",
        subject: tenantBScope,
      }),
      services.files.listPage(tenantBScope, {
        workspaceId: "workspace_tenant_b",
        query: "TENANT_A_",
        limit: 100,
        offset: 0,
      }),
      services.workspaceContent.list(
        tenantBScope,
        "memory",
        "workspace_tenant_b",
      ),
    ]);

    expect(tenantBChats).toEqual([]);
    expect(tenantBFiles).toMatchObject({ items: [], total: 0 });
    expect(tenantBMemories).toEqual([]);

    const ownerShares = await services.collaboration.listChatShares(
      seededSubject,
      "chat_welcome",
    );
    expect(ownerShares).toContainEqual(
      expect.objectContaining({ principalId: sentinels.share }),
    );
    expect(memory.body).toBe(sentinels.memory);

    const tenantBVisibleOutput = JSON.stringify({
      rejected: rejected.map((error) =>
        error instanceof Error ? error.message : String(error),
      ),
      tenantBChats,
      tenantBFiles,
      tenantBMemories,
    });
    for (const sentinel of Object.values(sentinels)) {
      expect(tenantBVisibleOutput).not.toContain(sentinel);
    }
  });
});
