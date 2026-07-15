import { describe, expect, it } from "vitest";
import { readEnv } from "@romeo/config";
import { MemoryObjectStore } from "@romeo/storage";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

describe("collaboration API", () => {
  it("searches share targets across same-org users, groups, and visible service accounts", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      id: "user_alice",
      orgId: "org_default",
      email: "alice@romeo.local",
      name: "Alice Reviewer",
    });
    const api = createRomeoApi(repository);
    const serviceAccountResponse = await api.request(
      "/api/v1/service-accounts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Indexer Worker", scopes: ["me:read"] }),
      },
    );
    const serviceAccount = await serviceAccountResponse.json();
    await api.request("/api/v1/agents/agent_default/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalType: "group",
        principalId: "group_reviewers",
        permissions: ["read"],
      }),
    });

    const userResponse = await api.request(
      "/api/v1/share-targets?query=alice&limit=5",
    );
    const userTargets = await userResponse.json();
    const groupResponse = await api.request(
      "/api/v1/share-targets?query=reviewers",
    );
    const groupTargets = await groupResponse.json();
    const serviceAccountSearchResponse = await api.request(
      "/api/v1/share-targets?query=indexer",
    );
    const serviceAccountTargets = await serviceAccountSearchResponse.json();

    expect(serviceAccountResponse.status).toBe(201);
    expect(userResponse.status).toBe(200);
    expect(userTargets.data).toContainEqual({
      principalType: "user",
      principalId: "user_alice",
      label: "Alice Reviewer",
      detail: "alice@romeo.local",
    });
    expect(groupTargets.data).toContainEqual({
      principalType: "group",
      principalId: "group_reviewers",
      label: "Reviewers",
    });
    expect(serviceAccountTargets.data).toContainEqual({
      principalType: "service_account",
      principalId: serviceAccount.data.id,
      label: "Indexer Worker",
    });
  });

  it("shares agents and knowledge bases through resource grants", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());

    const agentShareResponse = await api.request(
      "/api/v1/agents/agent_default/shares",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principalType: "group",
          principalId: "group_reviewers",
          permissions: ["read", "run"],
        }),
      },
    );
    const agentShare = await agentShareResponse.json();
    const agentSharesResponse = await api.request(
      "/api/v1/agents/agent_default/shares",
    );
    const agentShares = await agentSharesResponse.json();

    const kbShareResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/shares",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principalType: "group",
          principalId: "group_reviewers",
          permissions: ["read", "use"],
        }),
      },
    );
    const kbShare = await kbShareResponse.json();
    const kbSharesResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/shares",
    );
    const kbShares = await kbSharesResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=agent.share",
    );
    const audit = await auditResponse.json();

    expect(agentShareResponse.status).toBe(201);
    expect(
      agentShare.data
        .map((grant: { permission: string }) => grant.permission)
        .sort(),
    ).toEqual(["read", "run"]);
    expect(
      agentShares.data.some(
        (grant: { principalId: string }) =>
          grant.principalId === "group_reviewers",
      ),
    ).toBe(true);
    expect(kbShareResponse.status).toBe(201);
    expect(
      kbShare.data
        .map((grant: { permission: string }) => grant.permission)
        .sort(),
    ).toEqual(["read", "use"]);
    expect(
      kbShares.data.some(
        (grant: { principalId: string }) =>
          grant.principalId === "group_reviewers",
      ),
    ).toBe(true);
    expect(audit.data[0].resourceType).toBe("agent");
    expect(audit.data[0].resourceId).toBe("agent_default");
  });

  it("shares chats and allows granted non-admin readers to see chat runs", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    await repository.createRun({
      id: "run_shared_chat",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "completed",
      createdBy: "user_dev_admin",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    const serviceAccountResponse = await api.request(
      "/api/v1/service-accounts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Chat reader",
          scopes: ["me:read", "chats:read", "runs:read"],
        }),
      },
    );
    const serviceAccount = await serviceAccountResponse.json();
    const keyResponse = await api.request(
      `/api/v1/service-accounts/${serviceAccount.data.id}/api-keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Chat reader key",
          scopes: ["me:read", "chats:read", "runs:read"],
        }),
      },
    );
    const key = await keyResponse.json();
    const authHeaders = { authorization: `Bearer ${key.data.token}` };

    const deniedChatResponse = await api.request("/api/v1/chats/chat_welcome", {
      headers: authHeaders,
    });
    const shareResponse = await api.request(
      "/api/v1/chats/chat_welcome/shares",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principalType: "service_account",
          principalId: serviceAccount.data.id,
          permissions: ["read"],
        }),
      },
    );
    const share = await shareResponse.json();
    const chatResponse = await api.request("/api/v1/chats/chat_welcome", {
      headers: authHeaders,
    });
    const chat = await chatResponse.json();
    const chatsResponse = await api.request(
      "/api/v1/chats?workspaceId=workspace_default",
      { headers: authHeaders },
    );
    const chats = await chatsResponse.json();
    const runResponse = await api.request("/api/v1/runs/run_shared_chat", {
      headers: authHeaders,
    });
    const run = await runResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=chat.share",
    );
    const audit = await auditResponse.json();

    expect(deniedChatResponse.status).toBe(403);
    expect(shareResponse.status).toBe(201);
    expect(
      share.data.map((grant: { permission: string }) => grant.permission),
    ).toEqual(["read"]);
    expect(chatResponse.status).toBe(200);
    expect(chat.data.id).toBe("chat_welcome");
    expect(chats.data.map((item: { id: string }) => item.id)).toContain(
      "chat_welcome",
    );
    expect(runResponse.status).toBe(200);
    expect(run.data.id).toBe("run_shared_chat");
    expect(audit.data[0].resourceType).toBe("chat");
    expect(audit.data[0].resourceId).toBe("chat_welcome");
  });

  it("shares files and allows granted non-admin readers to fetch content", async () => {
    const objectStore = new MemoryObjectStore();
    const api = createRomeoApi(new InMemoryRomeoRepository(), { objectStore });
    const uploadResponse = await api.request("/api/v1/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        fileName: "shared-notes.txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        dataBase64: Buffer.from("shared notes").toString("base64"),
      }),
    });
    const uploaded = await uploadResponse.json();
    const serviceAccountResponse = await api.request(
      "/api/v1/service-accounts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "File reader",
          scopes: ["me:read", "files:read"],
        }),
      },
    );
    const serviceAccount = await serviceAccountResponse.json();
    const keyResponse = await api.request(
      `/api/v1/service-accounts/${serviceAccount.data.id}/api-keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "File reader key",
          scopes: ["me:read", "files:read"],
        }),
      },
    );
    const key = await keyResponse.json();
    const authHeaders = { authorization: `Bearer ${key.data.token}` };

    const deniedFileResponse = await api.request(
      `/api/v1/files/${uploaded.data.id}`,
      { headers: authHeaders },
    );
    const invalidShareResponse = await api.request(
      `/api/v1/files/${uploaded.data.id}/shares`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principalType: "service_account",
          principalId: serviceAccount.data.id,
          permissions: ["run"],
        }),
      },
    );
    const shareResponse = await api.request(
      `/api/v1/files/${uploaded.data.id}/shares`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principalType: "service_account",
          principalId: serviceAccount.data.id,
          permissions: ["read"],
        }),
      },
    );
    const share = await shareResponse.json();
    const sharesResponse = await api.request(
      `/api/v1/files/${uploaded.data.id}/shares`,
    );
    const shares = await sharesResponse.json();
    const fileResponse = await api.request(
      `/api/v1/files/${uploaded.data.id}`,
      {
        headers: authHeaders,
      },
    );
    const file = await fileResponse.json();
    const listResponse = await api.request(
      "/api/v1/files?workspaceId=workspace_default",
      { headers: authHeaders },
    );
    const listed = await listResponse.json();
    const contentResponse = await api.request(
      `/api/v1/files/${uploaded.data.id}/content`,
      { headers: authHeaders },
    );
    const content = await contentResponse.text();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=file.share",
    );
    const audit = await auditResponse.json();

    expect(uploadResponse.status).toBe(201);
    expect(deniedFileResponse.status).toBe(403);
    expect(invalidShareResponse.status).toBe(400);
    expect(shareResponse.status).toBe(201);
    expect(
      share.data.map((grant: { permission: string }) => grant.permission),
    ).toEqual(["read"]);
    expect(
      shares.data.some(
        (grant: { principalId: string }) =>
          grant.principalId === serviceAccount.data.id,
      ),
    ).toBe(true);
    expect(fileResponse.status).toBe(200);
    expect(file.data.id).toBe(uploaded.data.id);
    expect(JSON.stringify(file.data)).not.toContain("objectKey");
    expect(listed.data.map((item: { id: string }) => item.id)).toContain(
      uploaded.data.id,
    );
    expect(contentResponse.status).toBe(200);
    expect(content).toBe("shared notes");
    expect(audit.data[0].resourceType).toBe("file");
    expect(audit.data[0].resourceId).toBe(uploaded.data.id);
  });

  it("creates chat owner grants for non-admin API-created chats", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const serviceAccountResponse = await api.request(
      "/api/v1/service-accounts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Chat owner",
          scopes: ["me:read", "chats:read", "chats:write"],
        }),
      },
    );
    const serviceAccount = await serviceAccountResponse.json();
    const keyResponse = await api.request(
      `/api/v1/service-accounts/${serviceAccount.data.id}/api-keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Chat owner key",
          scopes: ["me:read", "chats:read", "chats:write"],
        }),
      },
    );
    const key = await keyResponse.json();
    const authHeaders = {
      authorization: `Bearer ${key.data.token}`,
      "content-type": "application/json",
    };

    const chatResponse = await api.request("/api/v1/chats", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        workspaceId: "workspace_default",
        title: "Owned by service account",
      }),
    });
    const chat = await chatResponse.json();
    const sharesResponse = await api.request(
      `/api/v1/chats/${chat.data.id}/shares`,
      {
        headers: { authorization: `Bearer ${key.data.token}` },
      },
    );
    const shares = await sharesResponse.json();

    expect(chatResponse.status).toBe(201);
    expect(sharesResponse.status).toBe(200);
    expect(
      shares.data
        .filter(
          (grant: { principalId: string }) =>
            grant.principalId === serviceAccount.data.id,
        )
        .map((grant: { permission: string }) => grant.permission)
        .sort(),
    ).toEqual(["read", "write"]);
  });

  it("creates shared folders and filters items by underlying resource access", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const folderResponse = await api.request("/api/v1/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Review pack",
      }),
    });
    const folder = await folderResponse.json();
    const agentItemResponse = await api.request(
      `/api/v1/folders/${folder.data.id}/items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "agent",
          resourceId: "agent_default",
        }),
      },
    );
    const chatItemResponse = await api.request(
      `/api/v1/folders/${folder.data.id}/items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "chat",
          resourceId: "chat_welcome",
        }),
      },
    );
    const chatItem = await chatItemResponse.json();
    const serviceAccountResponse = await api.request(
      "/api/v1/service-accounts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Folder reader",
          scopes: ["me:read", "agents:read", "chats:read", "knowledge:read"],
        }),
      },
    );
    const serviceAccount = await serviceAccountResponse.json();
    const keyResponse = await api.request(
      `/api/v1/service-accounts/${serviceAccount.data.id}/api-keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Folder reader key",
          scopes: ["me:read", "agents:read", "chats:read", "knowledge:read"],
        }),
      },
    );
    const key = await keyResponse.json();
    const folderShareResponse = await api.request(
      `/api/v1/folders/${folder.data.id}/shares`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principalType: "service_account",
          principalId: serviceAccount.data.id,
          permissions: ["read"],
        }),
      },
    );
    const emptyItemsResponse = await api.request(
      `/api/v1/folders/${folder.data.id}/items`,
      {
        headers: { authorization: `Bearer ${key.data.token}` },
      },
    );
    const emptyItems = await emptyItemsResponse.json();

    await api.request("/api/v1/chats/chat_welcome/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalType: "service_account",
        principalId: serviceAccount.data.id,
        permissions: ["read"],
      }),
    });
    const foldersResponse = await api.request(
      "/api/v1/folders?workspaceId=workspace_default",
      {
        headers: { authorization: `Bearer ${key.data.token}` },
      },
    );
    const folders = await foldersResponse.json();
    const visibleItemsResponse = await api.request(
      `/api/v1/folders/${folder.data.id}/items`,
      {
        headers: { authorization: `Bearer ${key.data.token}` },
      },
    );
    const visibleItems = await visibleItemsResponse.json();
    const deleteItemResponse = await api.request(
      `/api/v1/folders/${folder.data.id}/items/${chatItem.data.id}`,
      { method: "DELETE" },
    );
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=folder.item.add",
    );
    const audit = await auditResponse.json();

    expect(folderResponse.status).toBe(201);
    expect(folder.data.name).toBe("Review pack");
    expect(agentItemResponse.status).toBe(201);
    expect(chatItemResponse.status).toBe(201);
    expect(folderShareResponse.status).toBe(201);
    expect(emptyItemsResponse.status).toBe(200);
    expect(emptyItems.data).toEqual([]);
    expect(foldersResponse.status).toBe(200);
    expect(folders.data.map((item: { id: string }) => item.id)).toContain(
      folder.data.id,
    );
    expect(visibleItemsResponse.status).toBe(200);
    expect(visibleItems.data).toEqual([
      expect.objectContaining({
        resourceType: "chat",
        resourceId: "chat_welcome",
      }),
    ]);
    expect(deleteItemResponse.status).toBe(200);
    expect(
      audit.data.some(
        (event: { metadata: Record<string, unknown>; resourceId: string }) =>
          event.resourceId === folder.data.id &&
          event.metadata.resourceId === "chat_welcome",
      ),
    ).toBe(true);
    expect(JSON.stringify(audit.data)).not.toContain("Review pack");
  });

  it("creates chat comments with bounded same-org mentions", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const serviceAccountResponse = await api.request(
      "/api/v1/service-accounts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Comment worker",
          scopes: ["me:read", "chats:read", "chats:write"],
        }),
      },
    );
    const serviceAccount = await serviceAccountResponse.json();
    const keyResponse = await api.request(
      `/api/v1/service-accounts/${serviceAccount.data.id}/api-keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Comment worker key",
          scopes: ["me:read", "chats:read", "chats:write"],
        }),
      },
    );
    const key = await keyResponse.json();
    await api.request("/api/v1/chats/chat_welcome/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalType: "service_account",
        principalId: serviceAccount.data.id,
        permissions: ["read", "write"],
      }),
    });
    const channelResponse = await api.request("/api/v1/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "webhook",
        name: "Mention webhook",
        config: { url: "https://hooks.example.com/romeo" },
      }),
    });
    const channel = await channelResponse.json();

    const createResponse = await api.request(
      "/api/v1/chats/chat_welcome/comments",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.data.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          body: "Please review @user_dev_admin and ignore @missing_user.",
        }),
      },
    );
    const created = await createResponse.json();
    const listResponse = await api.request(
      "/api/v1/chats/chat_welcome/comments",
      {
        headers: { authorization: `Bearer ${key.data.token}` },
      },
    );
    const listed = await listResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=chat.comment",
    );
    const audit = await auditResponse.json();
    const notificationsResponse = await api.request("/api/v1/notifications");
    const notifications = await notificationsResponse.json();
    const deliveriesResponse = await api.request(
      "/api/v1/notification-deliveries",
    );
    const deliveries = await deliveriesResponse.json();
    const readResponse = await api.request(
      `/api/v1/notifications/${notifications.data[0].id}/read`,
      { method: "POST" },
    );
    const read = await readResponse.json();

    expect(channelResponse.status).toBe(201);
    expect(channel.data.config).toMatchObject({
      destinationConfigured: true,
      urlHost: "hooks.example.com",
    });
    expect(JSON.stringify(channel.data.config)).not.toContain(
      "https://hooks.example.com/romeo",
    );
    expect(createResponse.status).toBe(201);
    expect(created.data.authorId).toBe(serviceAccount.data.id);
    expect(created.data.mentionedUserIds).toEqual(["user_dev_admin"]);
    expect(listResponse.status).toBe(200);
    expect(listed.data[0].body).toContain("Please review");
    expect(audit.data[0].metadata.mentionedUserIds).toEqual(["user_dev_admin"]);
    expect(notificationsResponse.status).toBe(200);
    expect(notifications.data[0].type).toBe("chat_mention");
    expect(notifications.data[0].metadata.commentId).toBe(created.data.id);
    expect(deliveriesResponse.status).toBe(200);
    expect(deliveries.data[0]).toMatchObject({
      notificationId: notifications.data[0].id,
      channelId: channel.data.id,
      status: "disabled",
      attemptCount: 0,
      errorCode: "delivery_adapter_not_configured",
    });
    expect(deliveries.data[0].metadata).toEqual({
      notificationType: "chat_mention",
      channelType: "webhook",
    });
    expect(readResponse.status).toBe(200);
    expect(read.data.readAt).toBeDefined();
  });

  it("sends mention notifications through the opt-in webhook delivery adapter", async () => {
    const deliveries: Array<{ url: string; init?: RequestInit }> = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        NOTIFICATION_DELIVERY_DRIVER: "webhook",
        WEBHOOK_SIGNING_KEY: "test-webhook-signing-key-32-bytes",
      }),
      webhookFetch: async (input, init) => {
        const delivery: { url: string; init?: RequestInit } = {
          url: String(input),
        };
        if (init !== undefined) delivery.init = init;
        deliveries.push(delivery);
        return new Response(null, { status: 204 });
      },
    });
    const serviceAccountResponse = await api.request(
      "/api/v1/service-accounts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Comment worker",
          scopes: ["me:read", "chats:read", "chats:write"],
        }),
      },
    );
    const serviceAccount = await serviceAccountResponse.json();
    const keyResponse = await api.request(
      `/api/v1/service-accounts/${serviceAccount.data.id}/api-keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Comment worker key",
          scopes: ["me:read", "chats:read", "chats:write"],
        }),
      },
    );
    const key = await keyResponse.json();
    await api.request("/api/v1/chats/chat_welcome/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalType: "service_account",
        principalId: serviceAccount.data.id,
        permissions: ["read", "write"],
      }),
    });
    const channelResponse = await api.request("/api/v1/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "webhook",
        name: "Mention webhook",
        config: { url: "https://hooks.example.com/romeo" },
      }),
    });
    const commentResponse = await api.request(
      "/api/v1/chats/chat_welcome/comments",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.data.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          body: "Please review @user_dev_admin without leaking this sentence.",
        }),
      },
    );
    const notificationsResponse = await api.request("/api/v1/notifications");
    const notifications = await notificationsResponse.json();
    const deliveriesResponse = await api.request(
      "/api/v1/notification-deliveries",
    );
    const deliveryList = await deliveriesResponse.json();
    const sentBody = JSON.parse(String(deliveries[0]?.init?.body));

    expect(channelResponse.status).toBe(201);
    expect(commentResponse.status).toBe(201);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.url).toBe("https://hooks.example.com/romeo");
    expect(deliveries[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-romeo-event": "notification.chat_mention",
    });
    expect(
      String(
        (deliveries[0]?.init?.headers as Record<string, string>)[
          "x-romeo-signature"
        ],
      ),
    ).toMatch(/^v1=/u);
    expect(JSON.stringify(sentBody)).not.toContain(
      "without leaking this sentence",
    );
    expect(sentBody.data).toMatchObject({
      notificationId: notifications.data[0].id,
      notificationType: "chat_mention",
      resourceType: "chat",
      resourceId: "chat_welcome",
    });
    expect(deliveryList.data[0]).toMatchObject({
      notificationId: notifications.data[0].id,
      status: "sent",
      attemptCount: 1,
      metadata: {
        notificationType: "chat_mention",
        channelType: "webhook",
        responseStatus: 204,
      },
    });
    expect(deliveryList.data[0].deliveredAt).toBeDefined();
  });

  it("retries due failed notification deliveries through an admin job", async () => {
    const deliveries: Array<{ url: string; init?: RequestInit }> = [];
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, {
      env: readEnv({
        NOTIFICATION_DELIVERY_DRIVER: "webhook",
        WEBHOOK_SIGNING_KEY: "test-webhook-signing-key-32-bytes",
      }),
      webhookFetch: async (input, init) => {
        const delivery: { url: string; init?: RequestInit } = {
          url: String(input),
        };
        if (init !== undefined) delivery.init = init;
        deliveries.push(delivery);
        return new Response(null, { status: 204 });
      },
    });
    await repository.createNotificationDeliveryChannel({
      id: "notification_channel_retry",
      orgId: "org_default",
      userId: "user_dev_admin",
      type: "webhook",
      name: "Retry webhook",
      config: { url: "https://hooks.example.com/notifications" },
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repository.createUserNotification({
      id: "notification_retry",
      orgId: "org_default",
      userId: "user_dev_admin",
      type: "chat_mention",
      actorId: "user_dev_admin",
      resourceType: "chat",
      resourceId: "chat_welcome",
      metadata: {
        chatId: "chat_welcome",
        commentId: "comment_retry",
        rawBodySentinel: "notification retry raw body must not leak",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await repository.createNotificationDelivery({
      id: "notification_delivery_retry",
      orgId: "org_default",
      userId: "user_dev_admin",
      notificationId: "notification_retry",
      channelId: "notification_channel_retry",
      status: "failed",
      attemptCount: 1,
      errorCode: "network_error",
      metadata: {
        notificationType: "chat_mention",
        channelType: "webhook",
        nextAttemptAt: "2020-01-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const response = await api.request(
      "/api/v1/notification-deliveries/retry-due",
      { method: "POST" },
    );
    const retry = await response.json();
    const jobs = await repository.listBackgroundJobs("org_default");
    const sentBody = JSON.parse(String(deliveries[0]?.init?.body));

    expect(response.status).toBe(202);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.url).toBe("https://hooks.example.com/notifications");
    expect(JSON.stringify(sentBody)).not.toContain(
      "notification retry raw body must not leak",
    );
    expect(retry.data.job).toMatchObject({
      type: "notification.retry_due",
      status: "completed",
    });
    expect(retry.data.deliveries[0]).toMatchObject({
      id: "notification_delivery_retry",
      status: "sent",
      attemptCount: 2,
      metadata: {
        notificationType: "chat_mention",
        channelType: "webhook",
        responseStatus: 204,
      },
    });
    expect(retry.data.deliveries[0].errorCode).toBeUndefined();
    expect(retry.data.deliveries[0].metadata.nextAttemptAt).toBeUndefined();
    expect(
      jobs.some(
        (job) =>
          job.type === "notification.retry_due" && job.status === "completed",
      ),
    ).toBe(true);
  });

  it("suppresses channel-disabled notification types without egress", async () => {
    const deliveries: Array<{ url: string; init?: RequestInit }> = [];
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, {
      env: readEnv({
        NOTIFICATION_DELIVERY_DRIVER: "webhook",
        WEBHOOK_SIGNING_KEY: "test-webhook-signing-key-32-bytes",
      }),
      webhookFetch: async (input, init) => {
        const delivery: { url: string; init?: RequestInit } = {
          url: String(input),
        };
        if (init !== undefined) delivery.init = init;
        deliveries.push(delivery);
        return new Response(null, { status: 204 });
      },
    });
    await api.request("/api/v1/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "webhook",
        name: "Suppressed webhook",
        config: {
          url: "https://hooks.example.com/notifications",
          enabledNotificationTypes: [],
        },
      }),
    });

    const commentResponse = await api.request(
      "/api/v1/chats/chat_welcome/comments",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Suppressed mention @user_dev_admin" }),
      },
    );
    const deliveryListResponse = await api.request(
      "/api/v1/notification-deliveries",
    );
    const deliveryList = await deliveryListResponse.json();

    expect(commentResponse.status).toBe(201);
    expect(deliveries).toHaveLength(0);
    expect(deliveryList.data[0]).toMatchObject({
      status: "disabled",
      errorCode: "notification_type_suppressed_by_channel",
      metadata: {
        notificationType: "chat_mention",
        channelType: "webhook",
        policyBlocked: true,
      },
    });
  });

  it("enforces admin notification destination policy without exposing target values", async () => {
    const deliveries: Array<{ url: string; init?: RequestInit }> = [];
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, {
      env: readEnv({
        NOTIFICATION_DELIVERY_DRIVER: "webhook",
        WEBHOOK_SIGNING_KEY: "test-webhook-signing-key-32-bytes",
      }),
      webhookFetch: async (input, init) => {
        const delivery: { url: string; init?: RequestInit } = {
          url: String(input),
        };
        if (init !== undefined) delivery.init = init;
        deliveries.push(delivery);
        return new Response(null, { status: 204 });
      },
    });
    await api.request("/api/v1/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "webhook",
        name: "Blocked webhook",
        config: { url: "https://hooks.example.com/notifications" },
      }),
    });
    const policyResponse = await api.request(
      "/api/v1/admin/notification-policy",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowedWebhookHosts: ["allowed.example.com"] }),
      },
    );

    const commentResponse = await api.request(
      "/api/v1/chats/chat_welcome/comments",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: "Blocked policy mention @user_dev_admin with raw body",
        }),
      },
    );
    const deliveryListResponse = await api.request(
      "/api/v1/notification-deliveries",
    );
    const deliveryList = await deliveryListResponse.json();
    const auditLogs = await repository.listAuditLogs("org_default");

    expect(policyResponse.status).toBe(200);
    expect(commentResponse.status).toBe(201);
    expect(deliveries).toHaveLength(0);
    expect(deliveryList.data[0]).toMatchObject({
      status: "disabled",
      errorCode: "notification_destination_host_blocked_by_policy",
      metadata: {
        notificationType: "chat_mention",
        channelType: "webhook",
        policyBlocked: true,
      },
    });
    expect(JSON.stringify(deliveryList.data[0])).not.toContain(
      "hooks.example.com",
    );
    expect(
      auditLogs.find((log) => log.action === "admin.notification_policy.update")
        ?.metadata,
    ).toMatchObject({
      allowedWebhookHostCount: 1,
      allowedSlackHostCount: 0,
      allowedEmailDomainCount: 0,
    });
  });

  it("redacts notification channel config readback while retaining internal delivery config", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const rawWebhookUrl = "https://hooks.example.com/romeo/raw-webhook-secret";
    const rawSlackUrl = "https://hooks.slack.com/services/T/B/raw-secret";
    const rawTeamsUrl = "https://teams.example.com/hooks/raw-secret";
    const rawEmail = "Sensitive.Target+Raw@Example.com";
    const rawPagerDutyRef = "env://PAGERDUTY_RAW_ROUTING_KEY";
    const rawFcmTokenRef = "env://FCM_RAW_DEVICE_TOKEN";
    const created: unknown[] = [];

    for (const body of [
      {
        type: "webhook",
        name: "Webhook",
        config: { url: rawWebhookUrl },
      },
      {
        type: "slack",
        name: "Slack",
        config: { url: rawSlackUrl },
      },
      {
        type: "teams",
        name: "Teams",
        config: { url: rawTeamsUrl },
      },
      {
        type: "email",
        name: "Email",
        config: { to: rawEmail },
      },
      {
        type: "pagerduty",
        name: "PagerDuty",
        config: { routingKeyRef: rawPagerDutyRef, severity: "warning" },
      },
      {
        type: "mobile_push",
        name: "Mobile",
        config: {
          tokenRef: rawFcmTokenRef,
          platform: "ios",
          collapseKey: "mention",
        },
      },
    ]) {
      const response = await api.request("/api/v1/notification-channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
      created.push(await response.json());
    }

    const listResponse = await api.request("/api/v1/notification-channels");
    const listed = await listResponse.json();
    const publicReadback = JSON.stringify({ created, listed });
    for (const raw of [
      rawWebhookUrl,
      rawSlackUrl,
      rawTeamsUrl,
      rawEmail,
      rawEmail.toLowerCase(),
      rawPagerDutyRef,
      rawFcmTokenRef,
      "PAGERDUTY_RAW_ROUTING_KEY",
      "FCM_RAW_DEVICE_TOKEN",
    ]) {
      expect(publicReadback).not.toContain(raw);
    }
    expect(listed.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "webhook",
          config: {
            destinationConfigured: true,
            urlHost: "hooks.example.com",
          },
        }),
        expect.objectContaining({
          type: "email",
          config: {
            destinationConfigured: true,
            toDomain: "example.com",
          },
        }),
        expect.objectContaining({
          type: "pagerduty",
          config: {
            routingKeyConfigured: true,
            routingKeyRefScheme: "env",
            severity: "warning",
          },
        }),
        expect.objectContaining({
          type: "mobile_push",
          config: {
            tokenConfigured: true,
            tokenRefScheme: "env",
            platform: "ios",
            collapseKey: "mention",
          },
        }),
      ]),
    );

    const stored = await repository.listNotificationDeliveryChannels(
      "org_default",
      "user_dev_admin",
    );
    expect(
      stored.find((channel) => channel.type === "webhook")?.config.url,
    ).toBe(rawWebhookUrl);
    expect(stored.find((channel) => channel.type === "email")?.config.to).toBe(
      rawEmail.toLowerCase(),
    );
    expect(
      stored.find((channel) => channel.type === "pagerduty")?.config
        .routingKeyRef,
    ).toBe(rawPagerDutyRef);
    expect(
      stored.find((channel) => channel.type === "mobile_push")?.config.tokenRef,
    ).toBe(rawFcmTokenRef);
  });

  it("sends mention notifications through the opt-in Resend email delivery adapter without comment bodies", async () => {
    const deliveries: Array<{ url: string; init?: RequestInit }> = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        NOTIFICATION_DELIVERY_DRIVER: "resend-email",
        NOTIFICATION_EMAIL_FROM: "notify@romeo.example",
        NOTIFICATION_RESEND_API_KEY: "resend-test-key",
      }),
      webhookFetch: async (input, init) => {
        const delivery: { url: string; init?: RequestInit } = {
          url: String(input),
        };
        if (init !== undefined) delivery.init = init;
        deliveries.push(delivery);
        return new Response(JSON.stringify({ id: "email_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const serviceAccountResponse = await api.request(
      "/api/v1/service-accounts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Email comment worker",
          scopes: ["me:read", "chats:read", "chats:write"],
        }),
      },
    );
    const serviceAccount = await serviceAccountResponse.json();
    const keyResponse = await api.request(
      `/api/v1/service-accounts/${serviceAccount.data.id}/api-keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Email comment worker key",
          scopes: ["me:read", "chats:read", "chats:write"],
        }),
      },
    );
    const key = await keyResponse.json();
    await api.request("/api/v1/chats/chat_welcome/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalType: "service_account",
        principalId: serviceAccount.data.id,
        permissions: ["read", "write"],
      }),
    });
    const channelResponse = await api.request("/api/v1/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "email",
        name: "Mention email",
        config: { to: "Target@Example.com" },
      }),
    });
    const channel = await channelResponse.json();
    const commentResponse = await api.request(
      "/api/v1/chats/chat_welcome/comments",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.data.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          body: "Please review @user_dev_admin without leaking this email sentence.",
        }),
      },
    );
    const notificationsResponse = await api.request("/api/v1/notifications");
    const notifications = await notificationsResponse.json();
    const deliveriesResponse = await api.request(
      "/api/v1/notification-deliveries",
    );
    const deliveryList = await deliveriesResponse.json();
    const sentBody = JSON.parse(String(deliveries[0]?.init?.body));

    expect(channelResponse.status).toBe(201);
    expect(channel.data.config).toMatchObject({
      destinationConfigured: true,
      toDomain: "example.com",
    });
    expect(JSON.stringify(channel.data.config)).not.toContain(
      "target@example.com",
    );
    expect(commentResponse.status).toBe(201);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.url).toBe("https://api.resend.com/emails");
    expect(deliveries[0]?.init?.headers).toMatchObject({
      authorization: "Bearer resend-test-key",
      "content-type": "application/json",
    });
    expect(sentBody).toMatchObject({
      from: "notify@romeo.example",
      to: ["target@example.com"],
      subject: "Romeo notification: chat_mention",
    });
    expect(String(sentBody.text)).toContain(notifications.data[0].id);
    expect(String(sentBody.text)).toContain("chat_welcome");
    expect(JSON.stringify(sentBody)).not.toContain(
      "without leaking this email sentence",
    );
    expect(deliveryList.data[0]).toMatchObject({
      notificationId: notifications.data[0].id,
      channelId: channel.data.id,
      status: "sent",
      attemptCount: 1,
      metadata: {
        notificationType: "chat_mention",
        channelType: "email",
        provider: "resend",
        responseStatus: 200,
      },
    });
    expect(deliveryList.data[0].deliveredAt).toBeDefined();
  });

  it("sends mention notifications through the opt-in Slack webhook adapter without comment bodies", async () => {
    const deliveries: Array<{ url: string; init?: RequestInit }> = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        NOTIFICATION_DELIVERY_DRIVER: "slack-webhook",
      }),
      webhookFetch: async (input, init) => {
        const delivery: { url: string; init?: RequestInit } = {
          url: String(input),
        };
        if (init !== undefined) delivery.init = init;
        deliveries.push(delivery);
        return new Response("ok", { status: 200 });
      },
    });
    const serviceAccountResponse = await api.request(
      "/api/v1/service-accounts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Slack comment worker",
          scopes: ["me:read", "chats:read", "chats:write"],
        }),
      },
    );
    const serviceAccount = await serviceAccountResponse.json();
    const keyResponse = await api.request(
      `/api/v1/service-accounts/${serviceAccount.data.id}/api-keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Slack comment worker key",
          scopes: ["me:read", "chats:read", "chats:write"],
        }),
      },
    );
    const key = await keyResponse.json();
    await api.request("/api/v1/chats/chat_welcome/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalType: "service_account",
        principalId: serviceAccount.data.id,
        permissions: ["read", "write"],
      }),
    });
    const channelResponse = await api.request("/api/v1/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "slack",
        name: "Mention Slack",
        config: { url: "https://hooks.slack.com/services/T/B/C" },
      }),
    });
    const channel = await channelResponse.json();
    const commentResponse = await api.request(
      "/api/v1/chats/chat_welcome/comments",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.data.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          body: "Please review @user_dev_admin without leaking this slack sentence.",
        }),
      },
    );
    const notificationsResponse = await api.request("/api/v1/notifications");
    const notifications = await notificationsResponse.json();
    const deliveriesResponse = await api.request(
      "/api/v1/notification-deliveries",
    );
    const deliveryList = await deliveriesResponse.json();
    const sentBody = JSON.parse(String(deliveries[0]?.init?.body));

    expect(channelResponse.status).toBe(201);
    expect(commentResponse.status).toBe(201);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.url).toBe("https://hooks.slack.com/services/T/B/C");
    expect(deliveries[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
    });
    expect(String(sentBody.text)).toContain(notifications.data[0].id);
    expect(String(sentBody.text)).toContain("chat_welcome");
    expect(JSON.stringify(sentBody)).not.toContain(
      "without leaking this slack sentence",
    );
    expect(deliveryList.data[0]).toMatchObject({
      notificationId: notifications.data[0].id,
      channelId: channel.data.id,
      status: "sent",
      attemptCount: 1,
      metadata: {
        notificationType: "chat_mention",
        channelType: "slack",
        provider: "slack",
        responseStatus: 200,
      },
    });
    expect(deliveryList.data[0].deliveredAt).toBeDefined();
  });

  it("lists discoverable agents and manages favorites", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const galleryResponse = await api.request(
      "/api/v1/agent-gallery?workspaceId=workspace_default",
    );
    const gallery = await galleryResponse.json();

    const favoriteResponse = await api.request("/api/v1/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceType: "agent",
        resourceId: "agent_default",
      }),
    });
    const favorite = await favoriteResponse.json();
    const chatFavoriteResponse = await api.request("/api/v1/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceType: "chat",
        resourceId: "chat_welcome",
      }),
    });
    const chatFavorite = await chatFavoriteResponse.json();
    const duplicateResponse = await api.request("/api/v1/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceType: "agent",
        resourceId: "agent_default",
      }),
    });
    const duplicate = await duplicateResponse.json();

    const favoritedGalleryResponse = await api.request(
      "/api/v1/agent-gallery?workspaceId=workspace_default",
    );
    const favoritedGallery = await favoritedGalleryResponse.json();
    const favoritesResponse = await api.request("/api/v1/favorites");
    const favorites = await favoritesResponse.json();
    const deleteResponse = await api.request(
      `/api/v1/favorites/${favorite.data.id}`,
      { method: "DELETE" },
    );
    const deleteChatFavoriteResponse = await api.request(
      `/api/v1/favorites/${chatFavorite.data.id}`,
      { method: "DELETE" },
    );
    const afterDeleteResponse = await api.request("/api/v1/favorites");
    const afterDelete = await afterDeleteResponse.json();

    expect(galleryResponse.status).toBe(200);
    expect(
      gallery.data.some(
        (agent: { id: string }) => agent.id === "agent_default",
      ),
    ).toBe(true);
    expect(favoriteResponse.status).toBe(201);
    expect(chatFavoriteResponse.status).toBe(201);
    expect(chatFavorite.data.resourceType).toBe("chat");
    expect(duplicate.data.id).toBe(favorite.data.id);
    expect(
      favoritedGallery.data.find(
        (agent: { id: string }) => agent.id === "agent_default",
      ).favorite,
    ).toBe(true);
    expect(favorites.data).toHaveLength(2);
    expect(deleteResponse.status).toBe(200);
    expect(deleteChatFavoriteResponse.status).toBe(200);
    expect(afterDelete.data).toHaveLength(0);
  });

  it("rejects unsupported share permissions", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const response = await api.request("/api/v1/agents/agent_default/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalType: "group",
        principalId: "group_reviewers",
        permissions: ["use"],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_share_permission");
  });
});
