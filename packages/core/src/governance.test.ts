import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashApiKey } from "@romeo/auth";
import { readEnv } from "@romeo/config";
import { MemoryObjectStore } from "@romeo/storage";
import { DevVoiceProvider } from "@romeo/voices";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

describe("governance API", () => {
  it("filters audit logs and exports filtered CSV without raw metadata", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    await api.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Audit filter key", scopes: ["me:read"] }),
    });

    const filteredResponse = await api.request(
      "/api/v1/audit-logs?action=api_key.create&outcome=success",
    );
    const filtered = await filteredResponse.json();

    const csvResponse = await api.request(
      "/api/v1/audit-logs.csv?action=api_key.create",
    );
    const csv = await csvResponse.text();

    expect(filteredResponse.status).toBe(200);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].action).toBe("api_key.create");
    expect(csvResponse.headers.get("content-type")).toContain("text/csv");
    expect(csv).toContain('"api_key.create"');
    expect(csv).toContain('"metadataKeys"');
  });

  it("updates retention policy and records the change in audit logs", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());

    const getResponse = await api.request("/api/v1/governance/retention");
    const existing = await getResponse.json();
    const updateResponse = await api.request("/api/v1/governance/retention", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auditLogRetentionDays: 90 }),
    });
    const updated = await updateResponse.json();

    const invalidResponse = await api.request("/api/v1/governance/retention", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auditLogRetentionDays: 7 }),
    });
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=governance.retention.update",
    );
    const audit = await auditResponse.json();

    expect(getResponse.status).toBe(200);
    expect(existing.data.auditLogRetentionDays).toBe(365);
    expect(updateResponse.status).toBe(200);
    expect(updated.data.auditLogRetentionDays).toBe(90);
    expect(invalidResponse.status).toBe(400);
    expect(audit.data).toHaveLength(1);
  });

  it("enforces audit-log retention without deleting recent audit logs", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createAuditLog({
      id: "audit_old",
      orgId: "org_default",
      actorId: "user_dev_admin",
      action: "old.audit",
      resourceType: "organization",
      resourceId: "org_default",
      outcome: "success",
      metadata: { stale: true },
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    await repository.createAuditLog({
      id: "audit_recent",
      orgId: "org_default",
      actorId: "user_dev_admin",
      action: "recent.audit",
      resourceType: "organization",
      resourceId: "org_default",
      outcome: "success",
      metadata: { recent: true },
      createdAt: new Date().toISOString(),
    });
    const api = createRomeoApi(repository);

    const enforceResponse = await api.request(
      "/api/v1/governance/retention/enforce",
      { method: "POST" },
    );
    const enforced = await enforceResponse.json();
    const oldResponse = await api.request(
      "/api/v1/audit-logs?action=old.audit",
    );
    const old = await oldResponse.json();
    const recentResponse = await api.request(
      "/api/v1/audit-logs?action=recent.audit",
    );
    const recent = await recentResponse.json();
    const enforcementAuditResponse = await api.request(
      "/api/v1/audit-logs?action=governance.retention.enforce",
    );
    const enforcementAudit = await enforcementAuditResponse.json();

    expect(enforceResponse.status).toBe(200);
    expect(enforced.data.auditLogRetentionDays).toBe(365);
    expect(enforced.data.deletedAuditLogCount).toBe(1);
    expect(old.data).toHaveLength(0);
    expect(recent.data).toHaveLength(1);
    expect(enforcementAudit.data).toHaveLength(1);
    expect(enforcementAudit.data[0].metadata).toMatchObject({
      deletedAuditLogCount: 1,
    });
  });

  it("enforces browser automation artifact retention without leaking storage keys", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const staleKey =
      "browser-automation/org_default/job_browser_retention/browser_artifact_stale.png";
    const recentKey =
      "browser-automation/org_default/job_browser_retention/browser_artifact_recent.png";
    await objectStore.putObject({
      key: staleKey,
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
    await objectStore.putObject({
      key: recentKey,
      body: new Uint8Array([4, 5, 6]),
      contentType: "image/png",
    });
    await repository.createBackgroundJob({
      id: "job_browser_retention",
      orgId: "org_default",
      type: "workflow.browser_task.dispatch_request",
      status: "completed",
      payload: {
        browserArtifacts: [
          {
            artifactId: "browser_artifact_stale",
            artifactUrl:
              "/api/v1/browser-automation-artifacts/browser_artifact_stale",
            contentType: "image/png",
            registeredAt: "2020-01-01T00:00:00.000Z",
            registeredBy: "user_dev_admin",
            sizeBytes: 3,
            storageKey: staleKey,
            type: "screenshot",
          },
          {
            artifactId: "browser_artifact_recent",
            artifactUrl:
              "/api/v1/browser-automation-artifacts/browser_artifact_recent",
            contentType: "image/png",
            registeredAt: new Date().toISOString(),
            registeredBy: "user_dev_admin",
            sizeBytes: 3,
            storageKey: recentKey,
            type: "screenshot",
          },
        ],
      },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      completedAt: "2020-01-01T00:00:00.000Z",
    });
    const api = createRomeoApi(repository, { objectStore });

    const enforceResponse = await api.request(
      "/api/v1/governance/retention/enforce",
      { method: "POST" },
    );
    const enforced = await enforceResponse.json();
    const jobs = await repository.listBackgroundJobs("org_default");
    const retainedJob = jobs.find((job) => job.id === "job_browser_retention");
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=governance.retention.enforce",
    );
    const audit = await auditResponse.json();

    expect(enforceResponse.status).toBe(200);
    expect(enforced.data).toMatchObject({
      cleanedBrowserAutomationJobCount: 1,
      deletedBrowserAutomationArtifactCount: 1,
    });
    expect(await objectStore.getObject(staleKey)).toBeUndefined();
    expect([...(await objectStore.getObject(recentKey))!]).toEqual([4, 5, 6]);
    expect(retainedJob?.payload.browserArtifacts).toEqual([
      expect.objectContaining({ artifactId: "browser_artifact_recent" }),
    ]);
    expect(audit.data[0].metadata).toMatchObject({
      cleanedBrowserAutomationJobCount: 1,
      deletedBrowserAutomationArtifactCount: 1,
    });
    expect(JSON.stringify(enforced.data)).not.toContain("browser-automation/");
    expect(JSON.stringify(audit.data[0].metadata)).not.toContain(
      "browser-automation/",
    );
  });

  it("enforces voice artifact retention without leaking storage keys", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const api = createRomeoApi(repository, {
      objectStore,
      voiceProvider: new DevVoiceProvider(),
    });
    const previewResponse = await api.request(
      "/api/v1/voices/voice_default/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Expired retention voice secret." }),
      },
    );
    const preview = await previewResponse.json();
    const rawUsageBefore = await repository.listUsageEvents("org_default");
    const generated = rawUsageBefore.find(
      (event) => event.metric === "voice.preview.generated",
    );
    const storageKey = generated?.metadata.storageKey;
    if (generated === undefined || typeof storageKey !== "string") {
      throw new Error("Expected generated voice artifact usage event");
    }
    await repository.updateUsageEvent({
      ...generated,
      createdAt: "2020-01-01T00:00:00.000Z",
    });

    const enforceResponse = await api.request(
      "/api/v1/governance/retention/enforce",
      { method: "POST" },
    );
    const enforced = await enforceResponse.json();
    const secondEnforceResponse = await api.request(
      "/api/v1/governance/retention/enforce",
      { method: "POST" },
    );
    const secondEnforced = await secondEnforceResponse.json();
    const readAfterRetention = await api.request(preview.data.playbackUrl);
    const rawUsageAfter = await repository.listUsageEvents("org_default");
    const retained = rawUsageAfter.find(
      (event) => event.metric === "voice.preview.generated",
    );
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=governance.retention.enforce",
    );
    const audit = await auditResponse.json();
    const retentionAudit = audit.data.find(
      (entry: { metadata: Record<string, unknown> }) =>
        entry.metadata.deletedVoiceArtifactCount === 1,
    );

    expect(enforceResponse.status).toBe(200);
    expect(enforced.data).toMatchObject({
      cleanedVoiceArtifactUsageEventCount: 1,
      deletedVoiceArtifactCount: 1,
      missingVoiceArtifactCount: 0,
    });
    expect(secondEnforceResponse.status).toBe(200);
    expect(secondEnforced.data).toMatchObject({
      cleanedVoiceArtifactUsageEventCount: 0,
      deletedVoiceArtifactCount: 0,
      missingVoiceArtifactCount: 0,
    });
    expect(readAfterRetention.status).toBe(404);
    expect(await objectStore.getObject(storageKey)).toBeUndefined();
    expect(retained?.metadata.storageKey).toBeUndefined();
    expect(retained?.metadata.storageKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(retained?.metadata.artifactDeletionReason).toBe("retention");
    expect(retentionAudit?.metadata).toMatchObject({
      cleanedVoiceArtifactUsageEventCount: 1,
      deletedVoiceArtifactCount: 1,
      missingVoiceArtifactCount: 0,
    });
    expect(JSON.stringify(enforced.data)).not.toContain(storageKey);
    expect(JSON.stringify(retentionAudit?.metadata)).not.toContain(storageKey);
  });

  it("previews and executes governed chat data deletion without exporting deleted content", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    await repository.createChat({
      id: "chat_delete",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Sensitive title",
      createdBy: "user_dev_admin",
      updatedAt: now,
    });
    await repository.createMessage({
      id: "msg_delete",
      chatId: "chat_delete",
      role: "user",
      content: "secret message body",
      createdAt: now,
    });
    await repository.createMessageParts([
      {
        id: "part_delete",
        messageId: "msg_delete",
        type: "attachment",
        content: "attachment_ref",
        metadata: { fileName: "secret.txt" },
      },
    ]);
    await repository.createWorkspaceFolder({
      id: "folder_delete",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Deletion folder",
      createdBy: "user_dev_admin",
      createdAt: now,
      updatedAt: now,
    });
    await repository.createWorkspaceFolderItem({
      id: "folder_item_delete",
      orgId: "org_default",
      workspaceId: "workspace_default",
      folderId: "folder_delete",
      resourceType: "chat",
      resourceId: "chat_delete",
      createdAt: now,
    });
    await repository.createRun({
      id: "run_delete",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_delete",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "completed",
      createdBy: "user_dev_admin",
      createdAt: now,
      completedAt: now,
    });
    await repository.appendRunEvents([
      {
        id: "evt_delete_1",
        runId: "run_delete",
        sequence: 1,
        type: "run.completed",
        data: { output: "redacted" },
        createdAt: now,
      },
    ]);
    await repository.createChatComment({
      id: "comment_delete",
      orgId: "org_default",
      chatId: "chat_delete",
      authorId: "user_dev_admin",
      body: "delete comment body",
      mentionedUserIds: [],
      createdAt: now,
    });
    await repository.createUserNotification({
      id: "notification_delete",
      orgId: "org_default",
      userId: "user_dev_admin",
      type: "chat_mention",
      actorId: "user_dev_admin",
      resourceType: "chat",
      resourceId: "chat_delete",
      metadata: { chatId: "chat_delete", commentId: "comment_delete" },
      createdAt: now,
    });
    await repository.createNotificationDeliveryChannel({
      id: "channel_delete",
      orgId: "org_default",
      userId: "user_dev_admin",
      type: "webhook",
      name: "Deletion test",
      config: { url: "https://hooks.example/romeo" },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createNotificationDelivery({
      id: "delivery_delete",
      orgId: "org_default",
      userId: "user_dev_admin",
      notificationId: "notification_delete",
      channelId: "channel_delete",
      status: "disabled",
      attemptCount: 0,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    await repository.createToolCall({
      id: "tool_call_delete",
      orgId: "org_default",
      workspaceId: "workspace_default",
      agentId: "agent_default",
      actorId: "user_dev_admin",
      toolId: "tool_calculator",
      status: "success",
      riskLevel: "low",
      approvalRequired: false,
      inputKeys: ["expression"],
      outputKeys: ["value"],
      runId: "run_delete",
      startedAt: now,
      completedAt: now,
    });
    await repository.createUsageEvent({
      id: "usage_run_delete",
      orgId: "org_default",
      workspaceId: "workspace_default",
      actorId: "user_dev_admin",
      sourceType: "run",
      sourceId: "run_delete",
      metric: "run.completed",
      quantity: 1,
      unit: "run",
      metadata: {},
      createdAt: now,
    });
    await repository.createUsageEvent({
      id: "usage_voice_delete",
      orgId: "org_default",
      workspaceId: "workspace_default",
      actorId: "user_dev_admin",
      sourceType: "voice",
      sourceId: "voice_default",
      metric: "voice.message.generated",
      quantity: 1,
      unit: "ms",
      metadata: { chatId: "chat_delete", messageId: "msg_delete" },
      createdAt: now,
    });
    await repository.createResourceGrant({
      id: "grant_delete_chat",
      resourceType: "chat",
      resourceId: "chat_delete",
      principalType: "user",
      principalId: "user_dev_admin",
      permission: "write",
    });
    await repository.createResourceFavorite({
      id: "favorite_delete_chat",
      orgId: "org_default",
      userId: "user_dev_admin",
      resourceType: "chat",
      resourceId: "chat_delete",
      createdAt: now,
    });
    const api = createRomeoApi(repository);

    const previewResponse = await api.request(
      "/api/v1/governance/data-deletions/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "chat",
          resourceId: "chat_delete",
        }),
      },
    );
    const preview = await previewResponse.json();
    const mismatchResponse = await api.request(
      "/api/v1/governance/data-deletions/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "chat",
          resourceId: "chat_delete",
          confirmResourceId: "wrong_chat",
        }),
      },
    );
    const executeResponse = await api.request(
      "/api/v1/governance/data-deletions/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "chat",
          resourceId: "chat_delete",
          confirmResourceId: "chat_delete",
        }),
      },
    );
    const executed = await executeResponse.json();
    const deletedChatResponse = await api.request("/api/v1/chats/chat_delete");
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=governance.data_deletion.execute",
    );
    const audit = await auditResponse.json();
    const serializedAudit = JSON.stringify(audit);

    expect(previewResponse.status).toBe(200);
    expect(preview.data.schema).toBe("romeo.data-deletion-preview.v1");
    expect(preview.data.counts).toMatchObject({
      chats: 1,
      messages: 1,
      messageParts: 1,
      runs: 1,
      runSteps: 0,
      runEvents: 1,
      chatComments: 1,
      userNotifications: 1,
      notificationDeliveries: 1,
      runLinkedToolCalls: 1,
      usageEvents: 2,
      resourceGrants: 1,
      resourceFavorites: 1,
      workspaceFolderItems: 1,
    });
    expect(mismatchResponse.status).toBe(400);
    expect(executeResponse.status).toBe(200);
    expect(executed.data.schema).toBe("romeo.data-deletion-result.v1");
    expect(executed.data.counts).toEqual(preview.data.counts);
    expect(deletedChatResponse.status).toBe(404);
    expect(await repository.listMessageParts("msg_delete")).toHaveLength(0);
    expect(
      await repository.listWorkspaceFolderItems("folder_delete"),
    ).toHaveLength(0);
    expect(await repository.listRunEvents("run_delete")).toHaveLength(0);
    expect(audit.data[0].metadata.counts.messages).toBe(1);
    expect(serializedAudit).not.toContain("secret message body");
    expect(serializedAudit).not.toContain("delete comment body");
    expect(serializedAudit).not.toContain("Sensitive title");
  });

  it("previews and executes governed file object deletion without leaking object storage details", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const api = createRomeoApi(repository, { objectStore });
    const bytes = new TextEncoder().encode("secret file bytes");

    const uploadResponse = await api.request("/api/v1/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        fileName: "../Governed Delete.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.byteLength,
        dataBase64: Buffer.from(bytes).toString("base64"),
        purpose: "general",
        metadata: { label: "governed-delete" },
      }),
    });
    const uploaded = await uploadResponse.json();
    const fileId = uploaded.data.id;
    const objectKey = `files/org_default/workspace_default/${fileId}/${uploaded.data.fileName}`;

    expect(await objectStore.getObject(objectKey)).toBeDefined();

    const previewResponse = await api.request(
      "/api/v1/governance/data-deletions/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "file_object",
          resourceId: fileId,
        }),
      },
    );
    const preview = await previewResponse.json();
    const mismatchResponse = await api.request(
      "/api/v1/governance/data-deletions/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "file_object",
          resourceId: fileId,
          confirmResourceId: "wrong_file",
        }),
      },
    );
    const executeResponse = await api.request(
      "/api/v1/governance/data-deletions/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "file_object",
          resourceId: fileId,
          confirmResourceId: fileId,
        }),
      },
    );
    const executed = await executeResponse.json();
    const deletedFileResponse = await api.request(`/api/v1/files/${fileId}`);
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=governance.data_deletion.execute",
    );
    const audit = await auditResponse.json();
    const serializedAudit = JSON.stringify(audit);

    expect(uploadResponse.status).toBe(201);
    expect(await objectStore.getObject(objectKey)).toBeUndefined();
    expect(previewResponse.status).toBe(200);
    expect(preview.data.schema).toBe("romeo.data-deletion-preview.v1");
    expect(preview.data.resourceType).toBe("file_object");
    expect(preview.data.counts).toMatchObject({
      chats: 0,
      resourceGrants: 2,
      fileObjects: 1,
      objectStoreObjects: 1,
      objectStoreBytes: bytes.byteLength,
    });
    expect(mismatchResponse.status).toBe(400);
    expect(executeResponse.status).toBe(200);
    expect(executed.data.schema).toBe("romeo.data-deletion-result.v1");
    expect(executed.data.counts).toEqual(preview.data.counts);
    expect(deletedFileResponse.status).toBe(404);
    expect(await repository.getFileObject(fileId)).toMatchObject({
      id: fileId,
      status: "deleted",
    });
    expect(audit.data[0].metadata.counts.fileObjects).toBe(1);
    expect(serializedAudit).not.toContain("secret file bytes");
    expect(serializedAudit).not.toContain("Governed_Delete.txt");
    expect(serializedAudit).not.toContain("objectKey");
  });

  it("previews and executes governed knowledge source deletion through the knowledge service", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const content =
      "Governed knowledge source deletion removes source objects, chunks, and embeddings.";
    const api = createRomeoApi(repository, {
      objectStore,
      embeddingFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          input: string[];
          model: string;
        };
        return new Response(
          JSON.stringify({
            model: body.model,
            embeddings: body.input.map(() =>
              Array.from({ length: 1536 }, (_value, index) => index / 1536),
            ),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });
    const sourceResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "governed-source-delete.md",
          mimeType: "text/markdown",
          sizeBytes: content.length,
          content,
        }),
      },
    );
    const source = await sourceResponse.json();
    const sourceId = source.data.id;
    const objectKey = source.data.objectKey as string;
    const indexResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/embeddings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "provider_ollama",
          model: "nomic-embed-text",
          batchSize: 1,
        }),
      },
    );

    expect(await objectStore.getObject(objectKey)).toBeDefined();

    const previewResponse = await api.request(
      "/api/v1/governance/data-deletions/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "knowledge_source",
          resourceId: sourceId,
        }),
      },
    );
    const preview = await previewResponse.json();
    const mismatchResponse = await api.request(
      "/api/v1/governance/data-deletions/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "knowledge_source",
          resourceId: sourceId,
          confirmResourceId: "wrong_source",
        }),
      },
    );
    const executeResponse = await api.request(
      "/api/v1/governance/data-deletions/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "knowledge_source",
          resourceId: sourceId,
          confirmResourceId: sourceId,
        }),
      },
    );
    const executed = await executeResponse.json();
    const governanceAuditResponse = await api.request(
      "/api/v1/audit-logs?action=governance.data_deletion.execute",
    );
    const governanceAudit = await governanceAuditResponse.json();
    const sourceDeleteAuditResponse = await api.request(
      "/api/v1/audit-logs?action=knowledge.source.delete",
    );
    const sourceDeleteAudit = await sourceDeleteAuditResponse.json();
    const serializedAudit = JSON.stringify({
      governance: governanceAudit.data,
      knowledge: sourceDeleteAudit.data,
    });
    const governanceDeletionAudit = governanceAudit.data.find(
      (event: { resourceId: string }) => event.resourceId === sourceId,
    );

    expect(sourceResponse.status).toBe(202);
    expect(indexResponse.status).toBe(200);
    expect(await objectStore.getObject(objectKey)).toBeUndefined();
    expect(previewResponse.status).toBe(200);
    expect(preview.data).toMatchObject({
      schema: "romeo.data-deletion-preview.v1",
      resourceType: "knowledge_source",
      resourceId: sourceId,
      knowledgeBaseId: "kb_default",
      counts: {
        knowledgeSources: 1,
        knowledgeChunks: 1,
        knowledgeEmbeddings: 1,
        objectStoreObjects: 1,
        objectStoreBytes: content.length,
      },
    });
    expect(mismatchResponse.status).toBe(400);
    expect(executeResponse.status).toBe(200);
    expect(executed.data.schema).toBe("romeo.data-deletion-result.v1");
    expect(executed.data.counts).toEqual(preview.data.counts);
    expect(await repository.listKnowledgeSources("kb_default")).toEqual([]);
    expect(await repository.listKnowledgeChunks("kb_default")).toEqual([]);
    expect(await repository.listKnowledgeChunkEmbeddings("kb_default")).toEqual(
      [],
    );
    expect(governanceDeletionAudit?.metadata).toMatchObject({
      knowledgeBaseId: "kb_default",
      workspaceId: "workspace_default",
      counts: {
        knowledgeSources: 1,
        knowledgeChunks: 1,
        knowledgeEmbeddings: 1,
      },
    });
    expect(sourceDeleteAudit.data[0].metadata).toMatchObject({
      knowledgeBaseId: "kb_default",
      chunkCount: 1,
      embeddingCount: 1,
      objectDeleted: true,
    });
    expect(serializedAudit).not.toContain(content);
    expect(serializedAudit).not.toContain("governed-source-delete.md");
    expect(serializedAudit).not.toContain("knowledge/");
  });

  it("deletes writable chats through the native chat lifecycle API", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    await repository.createChat({
      id: "chat_native_delete",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Native sensitive title",
      createdBy: "user_dev_admin",
      updatedAt: now,
    });
    await repository.createMessage({
      id: "msg_native_delete",
      chatId: "chat_native_delete",
      role: "user",
      content: "native secret message body",
      createdAt: now,
    });
    const api = createRomeoApi(repository);

    const previewResponse = await api.request(
      "/api/v1/chats/chat_native_delete/delete-preview",
    );
    const preview = await previewResponse.json();
    const mismatchResponse = await api.request(
      "/api/v1/chats/chat_native_delete",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmChatId: "wrong_chat" }),
      },
    );
    const executeResponse = await api.request(
      "/api/v1/chats/chat_native_delete",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmChatId: "chat_native_delete" }),
      },
    );
    const executed = await executeResponse.json();
    const deletedChatResponse = await api.request(
      "/api/v1/chats/chat_native_delete",
    );
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=chat.delete",
    );
    const audit = await auditResponse.json();
    const serializedAudit = JSON.stringify(audit);

    expect(previewResponse.status).toBe(200);
    expect(preview.data.schema).toBe("romeo.data-deletion-preview.v1");
    expect(preview.data.counts).toMatchObject({ chats: 1, messages: 1 });
    expect(mismatchResponse.status).toBe(400);
    expect(executeResponse.status).toBe(200);
    expect(executed.data.schema).toBe("romeo.data-deletion-result.v1");
    expect(executed.data.counts).toEqual(preview.data.counts);
    expect(deletedChatResponse.status).toBe(404);
    expect(audit.data[0].metadata).toMatchObject({
      workspaceId: "workspace_default",
      deletionEngine: "governed_data_deletion",
      confirmationMatched: true,
    });
    expect(audit.data[0].metadata.counts.messages).toBe(1);
    expect(serializedAudit).not.toContain("native secret message body");
    expect(serializedAudit).not.toContain("Native sensitive title");
  });

  it("blocks governed data deletion while a chat is under legal hold", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    const legalHoldUntil = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await repository.createChat({
      id: "chat_hold",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Held matter",
      createdBy: "user_dev_admin",
      updatedAt: now,
    });
    const api = createRomeoApi(repository);

    const holdResponse = await api.request(
      "/api/v1/chats/chat_hold/legal-hold",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          legalHoldUntil,
          legalHoldReason: "Privileged investigation notes",
        }),
      },
    );
    const held = await holdResponse.json();
    const previewResponse = await api.request(
      "/api/v1/governance/data-deletions/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceType: "chat", resourceId: "chat_hold" }),
      },
    );
    const preview = await previewResponse.json();
    const blockedResponse = await api.request(
      "/api/v1/governance/data-deletions/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "chat",
          resourceId: "chat_hold",
          confirmResourceId: "chat_hold",
        }),
      },
    );
    const blocked = await blockedResponse.json();
    const clearResponse = await api.request(
      "/api/v1/chats/chat_hold/legal-hold",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legalHoldUntil: null }),
      },
    );
    const cleared = await clearResponse.json();
    const executeResponse = await api.request(
      "/api/v1/governance/data-deletions/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: "chat",
          resourceId: "chat_hold",
          confirmResourceId: "chat_hold",
        }),
      },
    );
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=chat.legal_hold.update",
    );
    const audit = await auditResponse.json();
    const serializedAudit = JSON.stringify(audit);

    expect(holdResponse.status).toBe(200);
    expect(held.data.legalHoldUntil).toBe(legalHoldUntil);
    expect(previewResponse.status).toBe(200);
    expect(preview.data.legalHold).toMatchObject({
      until: legalHoldUntil,
      reason: "Privileged investigation notes",
    });
    expect(blockedResponse.status).toBe(409);
    expect(blocked.error.code).toBe("data_deletion_legal_hold");
    expect(blocked.error.details.legalHoldUntil).toBe(legalHoldUntil);
    expect(clearResponse.status).toBe(200);
    expect(cleared.data.legalHoldUntil).toBeUndefined();
    expect(cleared.data.legalHoldReason).toBeUndefined();
    expect(executeResponse.status).toBe(200);
    expect(audit.data[0].metadata).toMatchObject({
      workspaceId: "workspace_default",
      legalHoldUntil,
      hasReason: true,
    });
    expect(serializedAudit).not.toContain("Privileged investigation notes");
  });

  it("reports metadata-only data rights coverage by storage class", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());

    const response = await api.request(
      "/api/v1/governance/data-rights/coverage",
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data.schema).toBe("romeo.data-rights-coverage.v1");
    expect(body.data.orgId).toBe("org_default");
    expect(body.data.supportedDeletionResourceTypes).toEqual([
      "chat",
      "file_object",
      "knowledge_source",
    ]);
    expect(
      body.data.deletionWorkflows.map(
        (workflow: { id: string }) => workflow.id,
      ),
    ).toContain("governed_chat_deletion");
    expect(
      body.data.exportWorkflows.map((workflow: { id: string }) => workflow.id),
    ).toContain("customer_content_export");
    expect(
      body.data.storageClasses.map(
        (storageClass: { id: string }) => storageClass.id,
      ),
    ).toEqual([
      "postgres_domain_records",
      "object_store_artifacts",
      "pgvector_embeddings",
      "external_vector_store",
      "audit_usage_metadata",
      "background_jobs",
      "operational_logs",
      "backups",
    ]);
    expect(body.data.backupRetention.status).toBe("externally_governed");
    expect(body.data.supportBundles.status).toBe("implemented");
    expect(body.data.retentionEvidence.operationalLogs.status).toBe(
      "external_required",
    );
    expect(body.data.retentionEvidence.backups.status).toBe(
      "external_required",
    );
    expect(body.data.retentionEvidence.redaction).toMatchObject({
      backupLocationReturned: false,
      evidenceFileBodiesReturned: false,
      logContentReturned: false,
      objectStoreKeysReturned: false,
      rawEvidencePathsReturned: false,
      secretValuesReturned: false,
    });
    const backgroundJobStorage = body.data.storageClasses.find(
      (storageClass: { id: string }) => storageClass.id === "background_jobs",
    );
    const externalVectorStorage = body.data.storageClasses.find(
      (storageClass: { id: string }) =>
        storageClass.id === "external_vector_store",
    );
    expect(externalVectorStorage).toMatchObject({
      exportCoverage: "partial",
      exportEvidence: ["customer_content_export"],
    });
    expect(backgroundJobStorage).toMatchObject({
      exportCoverage: "partial",
      exportEvidence: ["customer_content_export"],
    });
    expect(serialized).not.toContain("DATABASE_URL=");
    expect(serialized).not.toContain("secretRef");
    expect(serialized).not.toContain("objectKey");
    expect(serialized).not.toContain("vectorId");
  });

  it("reports mounted data-rights retention evidence without leaking evidence bodies or paths", async () => {
    const directory = mkdtempSync(join(tmpdir(), "romeo-data-rights-"));
    const logEvidencePath = join(directory, "logs.json");
    const backupEvidencePath = join(directory, "backups.json");
    writeFileSync(
      logEvidencePath,
      JSON.stringify({
        schemaVersion: "romeo.data-rights-retention-evidence.v1",
        generatedAt: "2026-07-02T00:00:00.000Z",
        control: "operational_logs",
        status: "passed",
        retentionDays: 30,
        destructionValidated: true,
        encryptedAtRest: true,
        immutableWindowDays: 7,
        reviewedSystemCount: 2,
        failureCodes: [],
        rawLogDestination: "raw-log-host-sentinel",
      }),
      "utf8",
    );
    writeFileSync(
      backupEvidencePath,
      JSON.stringify({
        schemaVersion: "romeo.data-rights-retention-evidence.v1",
        generatedAt: "2026-07-02T00:00:00.000Z",
        control: "backups",
        status: "failed",
        retentionDays: 90,
        destructionValidated: false,
        encryptedAtRest: true,
        reviewedSystemCount: 1,
        failureCodes: ["destruction_drill_missing"],
        backupLocation: "s3://tenant-sensitive-bucket/raw-key",
      }),
      "utf8",
    );
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_PATH: logEvidencePath,
        DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_PATH: backupEvidencePath,
      }),
    });

    const response = await api.request(
      "/api/v1/governance/data-rights/coverage",
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data.retentionEvidence.operationalLogs).toMatchObject({
      control: "operational_logs",
      status: "satisfied",
      evidence: {
        configured: true,
        retentionDays: 30,
        destructionValidated: true,
        encryptedAtRest: true,
        immutableWindowDays: 7,
        reviewedSystemCount: 2,
        failureCodes: [],
      },
    });
    expect(body.data.retentionEvidence.backups).toMatchObject({
      control: "backups",
      status: "failed",
      evidence: {
        configured: true,
        retentionDays: 90,
        destructionValidated: false,
        failureCodes: ["destruction_drill_missing"],
      },
    });
    expect(serialized).not.toContain(directory);
    expect(serialized).not.toContain(logEvidencePath);
    expect(serialized).not.toContain(backupEvidencePath);
    expect(serialized).not.toContain("raw-log-host-sentinel");
    expect(serialized).not.toContain("tenant-sensitive-bucket");
    expect(serialized).not.toContain("raw-key");
  });

  it("previews and executes governed customer data exports with explicit content and object-byte controls", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const now = new Date().toISOString();
    await repository.createChat({
      id: "chat_export",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Sensitive export title",
      createdBy: "user_dev_admin",
      updatedAt: now,
    });
    await repository.createMessage({
      id: "msg_export",
      chatId: "chat_export",
      role: "user",
      content: "secret export message",
      createdAt: now,
    });
    await repository.createChatComment({
      id: "comment_export",
      orgId: "org_default",
      chatId: "chat_export",
      authorId: "user_dev_admin",
      body: "secret export comment",
      mentionedUserIds: [],
      createdAt: now,
    });
    await repository.createKnowledgeBase({
      id: "kb_export",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Export KB",
      createdBy: "user_dev_admin",
      createdAt: now,
      updatedAt: now,
    });
    await objectStore.putObject({
      key: "knowledge/kb_export/source_export/export.md",
      body: new TextEncoder().encode("source bytes"),
      contentType: "text/markdown",
    });
    await repository.createKnowledgeSource({
      id: "source_export",
      knowledgeBaseId: "kb_export",
      orgId: "org_default",
      workspaceId: "workspace_default",
      fileName: "export.md",
      mimeType: "text/markdown",
      sizeBytes: 12,
      status: "indexed",
      objectKey: "knowledge/kb_export/source_export/export.md",
      metadata: {
        safe: "value",
        secretRef: "vault://hidden/path",
        objectKey: "should-not-export",
      },
      chunkCount: 1,
      contentHash: "hash_export",
      indexedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createKnowledgeChunks([
      {
        id: "chunk_export",
        knowledgeBaseId: "kb_export",
        sourceId: "source_export",
        orgId: "org_default",
        workspaceId: "workspace_default",
        sequence: 0,
        content: "secret chunk text",
        tokenCount: 3,
        metadata: {},
        createdAt: now,
      },
    ]);
    await objectStore.putObject({
      key: "files/org_default/workspace_default/file_export/export.txt",
      body: new TextEncoder().encode("file bytes"),
      contentType: "text/plain",
    });
    await repository.createFileObject({
      id: "file_export",
      orgId: "org_default",
      workspaceId: "workspace_default",
      ownerType: "user",
      ownerId: "user_dev_admin",
      fileName: "export.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      sha256:
        "27a4eecc15c09de9a62147235dd462f3c7ab56e808c3feef58d47c6b82d6243a",
      objectKey: "files/org_default/workspace_default/file_export/export.txt",
      purpose: "general",
      status: "available",
      metadata: { secretToken: "do-not-export" },
      createdAt: now,
      updatedAt: now,
    });
    await repository.createBackgroundJob({
      id: "job_export_payload",
      orgId: "org_default",
      workspaceId: "workspace_default",
      type: "browser.automation.task",
      status: "queued",
      payload: {
        prompt: "secret job prompt",
        rawSecret: "background job secret",
        objectKey: "background/jobs/secret-object.bin",
        browserArtifacts: [{ storageKey: "artifact-secret-key" }],
        vectorEndpoint: "https://qdrant.example.com",
        vectorCollection: "collection_customer",
        vectorNamespace: "namespace_org_default",
        vectorId: "vector_id_secret",
      },
      createdAt: now,
      updatedAt: now,
    });
    await repository.createBackgroundJob({
      id: "job_export_org_only",
      orgId: "org_default",
      type: "notification.retry_due",
      status: "queued",
      payload: {
        rawSecret: "org only background job secret",
      },
      createdAt: now,
      updatedAt: now,
    });
    await repository.createUsageEvent({
      id: "usage_voice_export",
      orgId: "org_default",
      workspaceId: "workspace_default",
      actorId: "user_dev_admin",
      sourceType: "voice",
      sourceId: "voice_default",
      metric: "voice.preview.generated",
      quantity: 1000,
      unit: "ms",
      metadata: {
        artifactId: "voice_artifact_export",
        contentType: "audio/wav",
        storageKey: "voice/org_default/voice_artifact_export/speech.wav",
      },
      createdAt: now,
    });
    const api = createRomeoApi(repository, { objectStore });
    const ragPolicyResponse = await api.request("/api/v1/admin/rag/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        externalVectorStore: {
          mode: "deployment_managed",
          namespacePolicy: "org",
          partitioningPolicy: "knowledge_base",
        },
        physicalVectorIsolation: {
          mode: "external_namespace_per_org",
          enforcement: "required",
        },
      }),
    });
    const ragPolicy = await ragPolicyResponse.json();

    const previewResponse = await api.request(
      "/api/v1/governance/data-exports/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "workspace",
          workspaceId: "workspace_default",
        }),
      },
    );
    const preview = await previewResponse.json();
    const metadataResponse = await api.request(
      "/api/v1/governance/data-exports/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "workspace",
          workspaceId: "workspace_default",
        }),
      },
    );
    const metadataExport = await metadataResponse.json();
    const contentResponse = await api.request(
      "/api/v1/governance/data-exports/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "workspace",
          workspaceId: "workspace_default",
          includeContent: true,
          includeObjectBytes: true,
          maxObjectBytes: 100,
        }),
      },
    );
    const contentExport = await contentResponse.json();
    const orgResponse = await api.request(
      "/api/v1/governance/data-exports/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "org", includeContent: true }),
      },
    );
    const orgExport = await orgResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=governance.data_export.execute",
    );
    const audit = await auditResponse.json();
    const metadataSerialized = JSON.stringify(metadataExport);
    const contentSerialized = JSON.stringify(contentExport);
    const orgSerialized = JSON.stringify(orgExport);
    const auditSerialized = JSON.stringify(audit);

    expect(previewResponse.status).toBe(200);
    expect(preview.data.schema).toBe("romeo.data-export-preview.v1");
    expect(preview.data.counts).toMatchObject({
      messages: 1,
      chatComments: 1,
      knowledgeSources: 1,
      knowledgeChunks: 1,
      fileObjects: 1,
      backgroundJobs: 1,
    });
    expect(preview.data.counts.chats).toBeGreaterThanOrEqual(1);
    expect(metadataResponse.status).toBe(200);
    expect(metadataExport.data.schema).toBe("romeo.data-export.v1");
    expect(metadataSerialized).not.toContain("secret export message");
    expect(metadataSerialized).not.toContain("secret export comment");
    expect(metadataSerialized).not.toContain("secret chunk text");
    expect(metadataSerialized).not.toContain("file bytes");
    expect(metadataSerialized).toContain("job_export_payload");
    expect(metadataSerialized).not.toContain("job_export_org_only");
    expect(metadataSerialized).not.toContain("secret job prompt");
    expect(metadataSerialized).not.toContain("background job secret");
    expect(contentResponse.status).toBe(200);
    expect(contentSerialized).toContain("secret export message");
    expect(contentSerialized).toContain("secret export comment");
    expect(contentSerialized).toContain("secret chunk text");
    expect(contentSerialized).toContain("ZmlsZSBieXRlcw==");
    expect(contentSerialized).toContain("c291cmNlIGJ5dGVz");
    expect(contentSerialized).not.toContain("vault://hidden/path");
    expect(contentSerialized).not.toContain("should-not-export");
    expect(contentSerialized).not.toContain(
      "files/org_default/workspace_default/file_export/export.txt",
    );
    const exportedVoiceUsage = contentExport.data.data.usageEvents.find(
      (event: { id: string }) => event.id === "usage_voice_export",
    );
    expect(exportedVoiceUsage?.metadataKeys).toContain("storageKeyHash");
    expect(exportedVoiceUsage?.metadataKeys).toContain("rawStorageKeyReturned");
    expect(exportedVoiceUsage?.metadataKeys).not.toContain("storageKey");
    expect(contentSerialized).not.toContain(
      "voice/org_default/voice_artifact_export/speech.wav",
    );
    expect(ragPolicyResponse.status).toBe(200);
    expect(ragPolicy.data.externalVectorStore).toMatchObject({
      mode: "deployment_managed",
      namespacePolicy: "org",
      partitioningPolicy: "knowledge_base",
      exportPolicy: "metadata_only",
    });
    expect(orgResponse.status).toBe(200);
    expect(orgExport.data.data.ragVectorPosture).toMatchObject({
      schema: "romeo.rag-vector-export-posture.v1",
      orgId: "org_default",
      externalVectorStore: {
        mode: "deployment_managed",
        configured: true,
        namespacePolicy: "org",
        partitioningPolicy: "knowledge_base",
        drStrategy: "postgres_authoritative_reindex",
        exportPolicy: "metadata_only",
        restoreValidation: "required_when_enabled",
      },
      physicalVectorIsolation: {
        mode: "external_namespace_per_org",
        enforcement: "required",
        configured: true,
        postgresAuthoritative: true,
        liveEvidenceRequired: true,
      },
      retention: {
        deleteVectorsOnSourceDelete: true,
        exportIncludesEmbeddingVectors: false,
      },
      redaction: {
        embeddingVectorsIncluded: false,
        externalVectorIdsIncluded: false,
        vectorStoreEndpointsIncluded: false,
        vectorStoreNamespacesIncluded: false,
        vectorStoreCollectionsIncluded: false,
        secretRefsIncluded: false,
      },
    });
    expect(orgExport.data.counts.backgroundJobs).toBeGreaterThanOrEqual(2);
    expect(orgExport.data.data.backgroundJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "job_export_payload",
          orgId: "org_default",
          workspaceId: "workspace_default",
          type: "browser.automation.task",
          status: "queued",
          payload: {
            included: false,
            reason: "background_job_payloads_excluded",
          },
        }),
        expect.objectContaining({
          id: "job_export_org_only",
          orgId: "org_default",
          type: "notification.retry_due",
          status: "queued",
          payload: {
            included: false,
            reason: "background_job_payloads_excluded",
          },
        }),
      ]),
    );
    expect(orgSerialized).toContain("job_export_payload");
    expect(orgSerialized).toContain("job_export_org_only");
    expect(orgSerialized).not.toContain("secret job prompt");
    expect(orgSerialized).not.toContain("org only background job secret");
    expect(orgSerialized).not.toContain("background job secret");
    expect(orgSerialized).not.toContain("background/jobs/secret-object.bin");
    expect(orgSerialized).not.toContain("artifact-secret-key");
    expect(orgSerialized).not.toContain("qdrant.example.com");
    expect(orgSerialized).not.toContain("collection_customer");
    expect(orgSerialized).not.toContain("namespace_org_default");
    expect(orgSerialized).not.toContain("vector_id_");
    expect(audit.data).toHaveLength(3);
    expect(auditSerialized).toContain("governance.data_export.execute");
    expect(auditSerialized).not.toContain("secret export message");
    expect(auditSerialized).not.toContain("secret chunk text");
    expect(auditSerialized).not.toContain("ZmlsZSBieXRlcw==");
  });

  it("packages governed data exports behind authorized object-store readback", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const now = new Date().toISOString();
    await repository.createChat({
      id: "chat_export_package",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Packaged export title",
      createdBy: "user_dev_admin",
      updatedAt: now,
    });
    await repository.createMessage({
      id: "msg_export_package",
      chatId: "chat_export_package",
      role: "user",
      content: "packaged secret export message",
      createdAt: now,
    });
    const api = createRomeoApi(repository, { objectStore });

    const packageResponse = await api.request(
      "/api/v1/governance/data-exports/packages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "workspace",
          workspaceId: "workspace_default",
          includeContent: true,
        }),
      },
    );
    const packaged = await packageResponse.json();
    const packageSerialized = JSON.stringify(packaged);
    const listResponse = await api.request(
      "/api/v1/governance/data-exports/packages",
    );
    const listed = await listResponse.json();
    const listSerialized = JSON.stringify(listed);
    const downloadResponse = await api.request(
      packaged.data.artifact.downloadUrl,
    );
    const downloaded = await downloadResponse.json();
    const mismatchDeleteResponse = await api.request(
      `/api/v1/governance/data-exports/packages/${packaged.data.packageId}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmPackageId: "export_pkg_bad" }),
      },
    );
    const deleteResponse = await api.request(
      `/api/v1/governance/data-exports/packages/${packaged.data.packageId}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmPackageId: packaged.data.packageId,
        }),
      },
    );
    const deleted = await deleteResponse.json();
    const deletedSerialized = JSON.stringify(deleted);
    const missingDownloadResponse = await api.request(
      packaged.data.artifact.downloadUrl,
    );
    const postDeleteListResponse = await api.request(
      "/api/v1/governance/data-exports/packages",
    );
    const postDeleteList = await postDeleteListResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();
    const auditSerialized = JSON.stringify(audit);

    expect(packageResponse.status).toBe(200);
    expect(packaged.data.schema).toBe("romeo.data-export-package.v1");
    expect(packaged.data.packageId).toMatch(/^export_pkg_[a-f0-9]{20}$/u);
    expect(packaged.data.artifact.downloadUrl).toBe(
      `/api/v1/governance/data-exports/packages/${packaged.data.packageId}/content`,
    );
    expect(packaged.data.artifact.storage.rawObjectKeyReturned).toBe(false);
    expect(packaged.data.artifact.storage.objectKeyHash).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(packageSerialized).not.toContain("packaged secret export message");
    expect(packageSerialized).not.toContain(
      "governance/data-exports/org_default",
    );
    expect(listResponse.status).toBe(200);
    expect(listed.data.schema).toBe("romeo.data-export-package-list.v1");
    expect(listed.data.packages).toHaveLength(1);
    expect(listed.data.packages[0]).toMatchObject({
      schema: "romeo.data-export-package-summary.v1",
      packageId: packaged.data.packageId,
    });
    expect(listed.data.redaction).toEqual({
      packageContentReturned: false,
      rawObjectKeysReturned: false,
    });
    expect(listSerialized).not.toContain("packaged secret export message");
    expect(listSerialized).not.toContain("governance/data-exports/org_default");
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toContain(
      "application/json",
    );
    expect(downloaded.schema).toBe("romeo.data-export.v1");
    expect(JSON.stringify(downloaded)).toContain(
      "packaged secret export message",
    );
    expect(mismatchDeleteResponse.status).toBe(400);
    expect(deleteResponse.status).toBe(200);
    expect(deleted.data).toMatchObject({
      schema: "romeo.data-export-package-delete-result.v1",
      packageId: packaged.data.packageId,
      redaction: {
        packageContentReturned: false,
        rawObjectKeysReturned: false,
      },
    });
    expect(deleted.data.storage.objectKeyHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(deletedSerialized).not.toContain("packaged secret export message");
    expect(deletedSerialized).not.toContain(
      "governance/data-exports/org_default",
    );
    expect(missingDownloadResponse.status).toBe(404);
    expect(postDeleteListResponse.status).toBe(200);
    expect(postDeleteList.data.packages).toHaveLength(0);
    expect(audit.data).toHaveLength(2);
    expect(auditSerialized).toContain("governance.data_export.package.create");
    expect(auditSerialized).toContain("governance.data_export.package.delete");
    expect(auditSerialized).toContain(packaged.data.packageId);
    expect(auditSerialized).not.toContain("packaged secret export message");
    expect(auditSerialized).not.toContain(
      "governance/data-exports/org_default",
    );
  });

  it("enforces retention for expired governed data export packages", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const now = new Date().toISOString();
    await repository.createChat({
      id: "chat_export_package_retention",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Retained export package title",
      createdBy: "user_dev_admin",
      updatedAt: now,
    });
    await repository.createMessage({
      id: "msg_export_package_retention",
      chatId: "chat_export_package_retention",
      role: "user",
      content: "expired package secret export message",
      createdAt: now,
    });
    const api = createRomeoApi(repository, { objectStore });

    const packageResponse = await api.request(
      "/api/v1/governance/data-exports/packages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "workspace",
          workspaceId: "workspace_default",
          includeContent: true,
        }),
      },
    );
    const packaged = await packageResponse.json();
    const registry = await repository.getSystemSetting(
      "governance.data_export_packages.org_default",
    );
    const oldCreatedAt = new Date(
      Date.now() - 400 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await repository.upsertSystemSetting({
      key: "governance.data_export_packages.org_default",
      updatedAt: oldCreatedAt,
      value: {
        ...registry!.value,
        packages: (
          registry!.value.packages as Array<Record<string, unknown>>
        ).map((item) => ({
          ...item,
          createdAt: oldCreatedAt,
        })),
      },
    });

    const retentionResponse = await api.request(
      "/api/v1/governance/retention/enforce",
      { method: "POST" },
    );
    const retention = await retentionResponse.json();
    const retentionSerialized = JSON.stringify(retention);
    const missingDownloadResponse = await api.request(
      packaged.data.artifact.downloadUrl,
    );
    const listResponse = await api.request(
      "/api/v1/governance/data-exports/packages",
    );
    const listed = await listResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=governance.retention.enforce",
    );
    const audit = await auditResponse.json();
    const auditSerialized = JSON.stringify(audit);

    expect(retentionResponse.status).toBe(200);
    expect(retention.data).toMatchObject({
      deletedDataExportPackageCount: 1,
      missingDataExportPackageCount: 0,
    });
    expect(retentionSerialized).not.toContain(
      "expired package secret export message",
    );
    expect(retentionSerialized).not.toContain(
      "governance/data-exports/org_default",
    );
    expect(missingDownloadResponse.status).toBe(404);
    expect(listResponse.status).toBe(200);
    expect(listed.data.packages).toHaveLength(0);
    expect(audit.data).toHaveLength(1);
    expect(auditSerialized).toContain("deletedDataExportPackageCount");
    expect(auditSerialized).not.toContain(
      "expired package secret export message",
    );
    expect(auditSerialized).not.toContain(
      "governance/data-exports/org_default",
    );
  });

  it("lists resource grants for access review", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const response = await api.request("/api/v1/access-review");
    const body = await response.json();
    const csvResponse = await api.request("/api/v1/access-review.csv");
    const csv = await csvResponse.text();

    expect(response.status).toBe(200);
    expect(
      body.data.some(
        (grant: { resourceType: string; resourceId: string }) =>
          grant.resourceType === "agent" &&
          grant.resourceId === "agent_default",
      ),
    ).toBe(true);
    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers.get("content-type")).toContain("text/csv");
    expect(csv).toContain("resource_type,resource_id,principal_type");
    expect(csv).toContain("agent,agent_default");
  });

  it("exports a redacted enterprise access review report", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    const rawSecret = "ACCESS_REVIEW_RAW_SECRET_SHOULD_NOT_EXPORT";
    const supportReason =
      "Support ticket investigation reason should not be exported.";
    await repository.createUser({
      id: "user_oidc_enterprise_target",
      orgId: "org_default",
      email: "enterprise-user@example.com",
      name: "Enterprise Target",
    });
    await repository.createServiceAccount({
      id: "service_account_enterprise",
      orgId: "org_default",
      name: "Enterprise Worker",
      scopes: ["tools:manage", "admin:read"],
      createdBy: "user_dev_admin",
      createdAt: now,
    });
    await repository.createApiKey({
      id: "api_key_enterprise_user",
      orgId: "org_default",
      userId: "user_oidc_enterprise_target",
      name: "Enterprise user key",
      hashedToken: await hashApiKey(rawSecret),
      scopes: ["me:read"],
      createdAt: now,
    });
    await repository.createApiKey({
      id: "api_key_enterprise_service",
      orgId: "org_default",
      serviceAccountId: "service_account_enterprise",
      name: "Enterprise service key",
      hashedToken: await hashApiKey(`${rawSecret}_service`),
      scopes: ["tools:manage"],
      createdAt: now,
    });
    await repository.createDelegatedOAuthConnection({
      id: "delegated_oauth_enterprise",
      orgId: "org_default",
      workspaceId: "workspace_default",
      userId: "user_oidc_enterprise_target",
      providerId: "github",
      connectorType: "github",
      providerAccountId: "12345",
      providerAccountLogin: "raw-gh-login-sensitive",
      scopes: ["repo", "read:user"],
      status: "active",
      token: {
        alg: "A256GCM",
        ciphertext: rawSecret,
        createdAt: now,
        iv: "iv",
        tag: "tag",
        v: 1,
      },
      createdAt: now,
      updatedAt: now,
    });
    await repository.createDataConnector({
      id: "data_connector_enterprise",
      orgId: "org_default",
      workspaceId: "workspace_default",
      knowledgeBaseId: "kb_default",
      type: "github",
      name: "Enterprise GitHub",
      config: {
        delegatedOAuthConnectionId: "delegated_oauth_enterprise",
        rawSecret,
        sourceAccessMode: "connector_owner",
      },
      status: "active",
      createdBy: "user_oidc_enterprise_target",
      createdAt: now,
      updatedAt: now,
    });
    await repository.createToolConnector({
      id: "tool_connector_enterprise",
      orgId: "org_default",
      type: "openapi",
      name: "Enterprise Tool",
      description: "Risky external tool",
      schema: { rawSecret },
      authConfig: { type: "bearer", secretRef: rawSecret },
      networkPolicy: {
        mode: "allow_hosts",
        allowedHosts: ["api.example.com"],
        allowPrivateNetwork: true,
      },
      riskLevel: "high",
      approvalPolicy: "always",
      visibility: "org",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createToolOperations([
      {
        id: "tool_operation_enterprise",
        orgId: "org_default",
        connectorId: "tool_connector_enterprise",
        operationId: "deleteThing",
        method: "delete",
        path: "/things/{id}",
        name: "Delete thing",
        description: "Deletes a thing",
        inputSchema: {},
        outputSchema: {},
        riskLevel: "high",
        approvalPolicy: "always",
        enabled: true,
        createdAt: now,
      },
    ]);
    await repository.createBackgroundJob({
      id: "job_enterprise_dispatch",
      orgId: "org_default",
      type: "tool.operation.dispatch_request",
      status: "queued",
      payload: { rawSecret },
      createdAt: now,
      updatedAt: now,
    });

    const api = createRomeoApi(repository);
    await api.request("/api/v1/admin/impersonation/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user_oidc_enterprise_target",
        confirmTargetUserId: "user_oidc_enterprise_target",
        reason: supportReason,
        ticketRef: "TICKET-789",
        ttlMinutes: 15,
      }),
    });
    await api.request("/api/v1/admin/impersonation/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "user_oidc_enterprise_target",
        confirmTargetUserId: "user_oidc_enterprise_target",
        reason: `${supportReason} pending`,
        ticketRef: "TICKET-790",
        ttlMinutes: 15,
      }),
    });

    const policyResponse = await api.request(
      "/api/v1/governance/identity-lifecycle-policy",
    );
    const policy = await policyResponse.json();
    const reportResponse = await api.request("/api/v1/access-review/report");
    const report = await reportResponse.json();
    const csvResponse = await api.request("/api/v1/access-review/report.csv");
    const csv = await csvResponse.text();
    const serialized = JSON.stringify(report);

    expect(policyResponse.status).toBe(200);
    expect(policy.data).toMatchObject({
      schema: "romeo.identity-lifecycle-policy.v1",
      orgId: "org_default",
      policy: {
        accountLinking: "disabled",
        scim: "disabled",
        oidcGroupSync: "additive_known_groups_only",
      },
      accountLinking: { status: "disabled" },
      scim: {
        status: "disabled",
        supportedResources: [],
      },
      groupLifecycle: {
        destructiveMembershipSync: "disabled",
        unknownExternalGroups: "ignored",
      },
      deprovisioning: {
        localUserDisable: "revokes_user_api_keys_and_sessions",
        oidcFeed: "admin_confirmed_issuer_subject",
        supportAccess: "time_bound_approved_audited_revocable",
      },
    });
    expect(policy.data.accountLinking.rationale).toContain("fail closed");
    expect(policy.data.scim.rationale).toContain("disabled");
    expect(JSON.stringify(policy.data)).not.toContain(rawSecret);
    expect(JSON.stringify(policy.data)).not.toContain(supportReason);
    expect(reportResponse.status).toBe(200);
    expect(report.data.schema).toBe("romeo.access-review-report.v1");
    expect(report.data.policy).toMatchObject({
      accountLinking: "disabled",
      scim: "disabled",
      oidcGroupSync: "additive_known_groups_only",
    });
    expect(report.data.summary).toMatchObject({
      activeServiceAccountApiKeyCount: 1,
      activeSupportSessionCount: 1,
      activeUserApiKeyCount: 1,
      dataConnectorCount: 1,
      delegatedOAuthConnectionCount: 1,
      queuedWorkerJobCount: 1,
      riskyToolConnectorCount: 1,
    });
    expect(
      report.data.users.find(
        (user: { id: string }) => user.id === "user_oidc_enterprise_target",
      ),
    ).toMatchObject({
      source: "oidc_derived",
      activeApiKeyCount: 1,
      activeSessionCount: 1,
    });
    expect(report.data.serviceAccounts[0]).toMatchObject({
      id: "service_account_enterprise",
      activeApiKeyCount: 1,
    });
    expect(report.data.connectorOwnership.dataConnectors[0]).toMatchObject({
      id: "data_connector_enterprise",
      configKeys: [
        "delegatedOAuthConnectionId",
        "rawSecret",
        "sourceAccessMode",
      ],
      delegatedOAuthConnectionId: "delegated_oauth_enterprise",
      sourceAccessMode: "connector_owner",
    });
    expect(
      report.data.connectorOwnership.delegatedOAuthConnections[0],
    ).toMatchObject({
      id: "delegated_oauth_enterprise",
      providerAccountLoginConfigured: true,
      providerAccountLoginHash: expect.any(String),
      scopeCount: 2,
      status: "active",
    });
    expect(report.data.toolRisk.connectors[0]).toMatchObject({
      id: "tool_connector_enterprise",
      approvalRequiredOperationCount: 1,
      highRiskOperationCount: 1,
      allowPrivateNetwork: true,
    });
    expect(report.data.toolRisk.workerJobs[0]).toMatchObject({
      type: "tool.operation.dispatch_request",
      status: "queued",
      count: 1,
    });
    expect(report.data.supportAccess.requests[0]).toMatchObject({
      status: "pending",
      ticketRef: "TICKET-790",
    });
    expect(report.data.supportAccess.sessions[0]).toMatchObject({
      status: "active",
      ticketRef: "TICKET-789",
      targetUserId: "user_oidc_enterprise_target",
    });
    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers.get("content-type")).toContain("text/csv");
    expect(csv).toContain("category,id,type,status,owner_or_principal");
    expect(csv).toContain("tool_connector,tool_connector_enterprise");
    expect(csv).toContain("support_session");
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).not.toContain(supportReason);
    expect(csv).not.toContain(rawSecret);
    expect(csv).not.toContain(supportReason);
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("hashedToken");
    expect(serialized).not.toContain("secretRef");
    expect(serialized).not.toContain("raw-gh-login-sensitive");
  });

  it("exports a sanitized compliance report as JSON and CSV", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createAuditLog({
      id: "audit_sensitive_metadata",
      orgId: "org_default",
      actorId: "user_dev_admin",
      action: "sensitive.audit",
      resourceType: "organization",
      resourceId: "org_default",
      outcome: "success",
      metadata: { secret: "do-not-export" },
      createdAt: new Date().toISOString(),
    });
    const api = createRomeoApi(repository);

    const reportResponse = await api.request(
      "/api/v1/governance/compliance-report",
    );
    const report = await reportResponse.json();
    const csvResponse = await api.request(
      "/api/v1/governance/compliance-report.csv",
    );
    const csv = await csvResponse.text();
    const serialized = JSON.stringify(report);

    expect(reportResponse.status).toBe(200);
    expect(report.data.schema).toBe("romeo.compliance-report.v1");
    expect(
      report.data.controls.some(
        (control: { id: string }) => control.id === "retention_policy",
      ),
    ).toBe(true);
    expect(
      report.data.controls.find(
        (control: { id: string }) => control.id === "audit_log_coverage",
      ).evidence.auditLogCount,
    ).toBeGreaterThan(0);
    expect(serialized).not.toContain("do-not-export");
    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers.get("content-type")).toContain("text/csv");
    expect(csv).toContain("control_id,title,status,evidence_json");
    expect(csv).toContain("retention_policy");
    expect(csv).not.toContain("do-not-export");
  });
});
