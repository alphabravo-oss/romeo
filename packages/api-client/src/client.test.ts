import { describe, expect, it } from "vitest";

import { RomeoApiClient } from "./client";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

describe("RomeoApiClient", () => {
  it("unwraps API envelopes and sends bearer JSON requests", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example/",
      apiKey: "rmk_test",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { id: "run_1", status: "queued" } });
      },
    });

    const run = await client.chatApi.startRun({
      chatId: "chat_1",
      agentId: "agent_1",
      content: "Hello",
    });

    expect(run).toMatchObject({ id: "run_1", status: "queued" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/runs");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: "Bearer rmk_test",
      "content-type": "application/json",
    });
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        chatId: "chat_1",
        agentId: "agent_1",
        content: "Hello",
      }),
    );
  });

  it("sends image attachments when starting chat runs", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example/",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { id: "run_1", status: "queued" } });
      },
    });

    await client.chatApi.startRun({
      chatId: "chat_1",
      agentId: "agent_1",
      content: "See attached image.",
      attachments: [
        {
          fileName: "diagram.png",
          mimeType: "image/png",
          sizeBytes: 6,
          dataBase64: "iVBORw0K",
        },
      ],
    });

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/runs");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        chatId: "chat_1",
        agentId: "agent_1",
        content: "See attached image.",
        attachments: [
          {
            fileName: "diagram.png",
            mimeType: "image/png",
            sizeBytes: 6,
            dataBase64: "iVBORw0K",
          },
        ],
      }),
    );
  });

  it("encodes path and query parameters", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: [] });
      },
    });

    await client.agent.get("agent/1");
    await client.agentById("agent/1");
    await client.agent.diffVersions("agent/1", "left version", "right&version");

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/agents/agent%2F1");
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/agents/agent%2F1");
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/agents/agent%2F1/versions/left%20version/diff?compareTo=right%26version",
    );
  });

  it("exports and imports portable agent documents through the agent resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { id: "agent_imported" } });
      },
    });
    const document = {
      schemaVersion: 1 as const,
      exportedAt: "2026-06-27T00:00:00.000Z",
      agent: {
        name: "Portable agent",
        baseModelId: "model_1",
        systemPrompt: "Use the bound resources.",
        parameters: { temperature: 0.2 },
        memoryPolicy: { mode: "recent_messages" as const, maxMessages: 4 },
        safetySettings: {
          maxUserInputLength: 1200,
          blockedTerms: ["internal-only"],
        },
        voiceProfileId: "voice_1",
        accessGrants: [
          {
            principalType: "group" as const,
            principalId: "group_reviewers",
            permissions: ["read" as const, "run" as const],
          },
        ],
        knowledgeBaseBindings: [{ knowledgeBaseId: "kb_1", enabled: true }],
        toolBindings: [
          { toolId: "tool_calculator", enabled: true, approvalRequired: false },
        ],
      },
    };

    await client.agent.exportAgent("agent/1");
    await client.agent.importAgent({ workspaceId: "workspace_1", document });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/agents/agent%2F1/export",
    );
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/agents/import");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({ workspaceId: "workspace_1", document }),
    );
  });

  it("supports chat list, update, archive, tags, delete, fork, feedback, unarchive, and legal hold paths", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { id: "chat_1" } });
      },
    });

    await client.chats({ workspaceId: "workspace_1", archived: "archived" });
    await client.updateChat("chat/1", { title: "Renamed chat" });
    await client.archiveChat("chat/1");
    await client.chatTags();
    await client.taggedChats("important_work", { archived: "all" });
    await client.chatTagAssignments("chat/1");
    await client.assignChatTag("chat/1", { name: "Important Work" });
    await client.removeChatTag("chat/1", "important_work");
    await client.deleteChatPreview("chat/1");
    await client.deleteChat("chat/1", { confirmChatId: "chat/1" });
    await client.forkChat("chat/1", {
      title: "Branch",
      throughMessageId: "message/2",
      includeAttachments: false,
    });
    await client.messageFeedbackList("chat/1");
    await client.messageFeedback("chat/1", "message/2");
    await client.updateMessageFeedback("chat/1", "message/2", {
      rating: "negative",
      reasonCode: "incorrect",
    });
    await client.unarchiveChat("chat/1");
    await client.updateChatLegalHold("chat/1", {
      legalHoldUntil: "2026-07-27T00:00:00.000Z",
      legalHoldReason: "Matter 42",
    });
    await client.chatApi.updateLegalHold("chat/1", { legalHoldUntil: null });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/chats?workspaceId=workspace_1&archived=archived",
    );
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/chats/chat%2F1");
    expect(calls[1]?.init?.method).toBe("PATCH");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({ title: "Renamed chat" }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/archive",
    );
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[3]?.url).toBe("https://romeo.example/api/v1/chat-tags");
    expect(calls[3]?.init?.method).toBe("GET");
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/chat-tags/important_work/chats?archived=all",
    );
    expect(calls[4]?.init?.method).toBe("GET");
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/tag-assignments",
    );
    expect(calls[5]?.init?.method).toBe("GET");
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/tag-assignments",
    );
    expect(calls[6]?.init?.method).toBe("POST");
    expect(calls[6]?.init?.body).toBe(
      JSON.stringify({ name: "Important Work" }),
    );
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/tag-assignments/important_work",
    );
    expect(calls[7]?.init?.method).toBe("DELETE");
    expect(calls[8]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/delete-preview",
    );
    expect(calls[8]?.init?.method).toBe("GET");
    expect(calls[9]?.url).toBe("https://romeo.example/api/v1/chats/chat%2F1");
    expect(calls[9]?.init?.method).toBe("DELETE");
    expect(calls[9]?.init?.body).toBe(
      JSON.stringify({ confirmChatId: "chat/1" }),
    );
    expect(calls[10]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/fork",
    );
    expect(calls[10]?.init?.method).toBe("POST");
    expect(calls[10]?.init?.body).toBe(
      JSON.stringify({
        title: "Branch",
        throughMessageId: "message/2",
        includeAttachments: false,
      }),
    );
    expect(calls[11]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/message-feedback",
    );
    expect(calls[11]?.init?.method).toBe("GET");
    expect(calls[12]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/messages/message%2F2/feedback",
    );
    expect(calls[12]?.init?.method).toBe("GET");
    expect(calls[13]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/messages/message%2F2/feedback",
    );
    expect(calls[13]?.init?.method).toBe("POST");
    expect(calls[13]?.init?.body).toBe(
      JSON.stringify({ rating: "negative", reasonCode: "incorrect" }),
    );
    expect(calls[14]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/unarchive",
    );
    expect(calls[14]?.init?.method).toBe("POST");
    expect(calls[15]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/legal-hold",
    );
    expect(calls[15]?.init?.body).toBe(
      JSON.stringify({
        legalHoldUntil: "2026-07-27T00:00:00.000Z",
        legalHoldReason: "Matter 42",
      }),
    );
    expect(calls[16]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/legal-hold",
    );
    expect(calls[16]?.init?.body).toBe(
      JSON.stringify({ legalHoldUntil: null }),
    );
  });

  it("supports native collaboration channel paths", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { id: "channel_1" } });
      },
    });

    await client.listChannels();
    await client.createChannel({
      workspaceId: "workspace 1",
      type: "group",
      name: "Team Room",
      private: true,
      userIds: ["user 2"],
    });
    await client.directMessageChannel({ userId: "user 2" });
    await client.channel("channel/1");
    await client.updateChannel("channel/1", { name: "Renamed" });
    await client.channelMembers("channel/1");
    await client.addChannelMembers("channel/1", { userIds: ["user 3"] });
    await client.removeChannelMember("channel/1", "user 3");
    await client.channelMessages("channel/1", { limit: 25, offset: 2 });
    await client.postChannelMessage("channel/1", {
      content: "Release is ready.",
      clientMessageId: "client/1",
    });
    await client.markChannelRead("channel/1");
    await client.pinnedChannelMessages("channel/1", 2);
    await client.channelMessage("channel/1", "message/1");
    await client.updateChannelMessage("channel/1", "message/1", {
      content: "Release moved.",
    });
    await client.deleteChannelMessage("channel/1", "message/1");
    await client.threadChannelMessages("channel/1", "message/1", {
      limit: 10,
    });
    await client.pinChannelMessage("channel/1", "message/1", {
      pinned: true,
    });
    await client.addChannelReaction("channel/1", "message/1", "thumbs_up");
    await client.removeChannelReaction("channel/1", "message/1", "thumbs_up");
    await client.deleteChannel("channel/1");

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels",
    );
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels",
    );
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        workspaceId: "workspace 1",
        type: "group",
        name: "Team Room",
        private: true,
        userIds: ["user 2"],
      }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/direct-messages",
    );
    expect(calls[2]?.init?.body).toBe(JSON.stringify({ userId: "user 2" }));
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1",
    );
    expect(calls[4]?.init?.method).toBe("PATCH");
    expect(calls[4]?.init?.body).toBe(JSON.stringify({ name: "Renamed" }));
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1/members",
    );
    expect(calls[6]?.init?.method).toBe("POST");
    expect(calls[6]?.init?.body).toBe(JSON.stringify({ userIds: ["user 3"] }));
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1/members/user%203",
    );
    expect(calls[7]?.init?.method).toBe("DELETE");
    expect(calls[8]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1/messages?limit=25&offset=2",
    );
    expect(calls[9]?.init?.body).toBe(
      JSON.stringify({
        content: "Release is ready.",
        clientMessageId: "client/1",
      }),
    );
    expect(calls[10]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1/read",
    );
    expect(calls[11]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1/messages/pinned?page=2",
    );
    expect(calls[12]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1/messages/message%2F1",
    );
    expect(calls[13]?.init?.method).toBe("PATCH");
    expect(calls[14]?.init?.method).toBe("DELETE");
    expect(calls[15]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1/messages/message%2F1/thread?limit=10",
    );
    expect(calls[16]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1/messages/message%2F1/pin",
    );
    expect(calls[16]?.init?.body).toBe(JSON.stringify({ pinned: true }));
    expect(calls[17]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1/messages/message%2F1/reactions",
    );
    expect(calls[17]?.init?.body).toBe(JSON.stringify({ name: "thumbs_up" }));
    expect(calls[18]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1/messages/message%2F1/reactions/thumbs_up",
    );
    expect(calls[19]?.url).toBe(
      "https://romeo.example/api/v1/collaboration/channels/channel%2F1",
    );
    expect(calls[19]?.init?.method).toBe("DELETE");
  });

  it("supports file metadata and byte readback paths", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        const url = new URL(String(input));
        if (url.pathname.endsWith("/content")) {
          return new Response(new TextEncoder().encode("hello files"), {
            headers: { "content-type": "text/plain" },
          });
        }
        if (
          (url.pathname === "/api/v1/files/uploads" ||
            url.pathname.endsWith("/uploads/file%201")) &&
          init?.method !== "DELETE"
        ) {
          return jsonResponse({
            data: {
              file: {
                id: "file_1",
                status: "uploading",
                contentUrl: null,
              },
              upload: {
                url: "https://objects.example/upload",
                method: "PUT",
                headers: { "content-type": "text/plain" },
                expiresAt: "2026-07-02T00:00:00.000Z",
                maxBytes: 100000000,
              },
            },
          });
        }
        if (
          url.pathname === "/api/v1/files/uploads/resumable" ||
          url.pathname.includes("/api/v1/files/uploads/resumable/file%201")
        ) {
          if (init?.method === "DELETE") {
            return jsonResponse({
              data: { id: "file_1", contentUrl: null, status: "deleted" },
            });
          }
          if (url.pathname.endsWith("/complete")) {
            return jsonResponse({
              data: {
                id: "file_1",
                contentUrl: "/api/v1/files/file_1/content",
                status: "available",
              },
            });
          }
          return jsonResponse({
            data: {
              file: {
                id: "file_1",
                status: "uploading",
                contentUrl: null,
              },
              upload: {
                mode: "resumable_backend_composed",
                partCount: 2,
                partSizeBytes: 6,
                maxBytes: 500000000,
                parts: [
                  {
                    partNumber: 1,
                    sizeBytes: 6,
                    upload: {
                      url: "https://objects.example/upload-part-1",
                      method: "PUT",
                      headers: { "content-type": "application/octet-stream" },
                      expiresAt: "2026-07-02T00:00:00.000Z",
                    },
                  },
                  {
                    partNumber: 2,
                    sizeBytes: 5,
                    upload: {
                      url: "https://objects.example/upload-part-2",
                      method: "PUT",
                      headers: { "content-type": "application/octet-stream" },
                      expiresAt: "2026-07-02T00:00:00.000Z",
                    },
                  },
                ],
              },
            },
          });
        }
        return jsonResponse({
          data:
            init?.method === "GET" && url.pathname.endsWith("/api/v1/files")
              ? [{ id: "file_1", contentUrl: "/api/v1/files/file_1/content" }]
              : { id: "file_1", contentUrl: "/api/v1/files/file_1/content" },
        });
      },
    });

    const created = await client.createFile({
      workspaceId: "workspace 1",
      fileName: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 11,
      dataBase64: "aGVsbG8gZmlsZXM=",
    });
    const uploadSession = await client.createFileUploadSession({
      workspaceId: "workspace 1",
      fileName: "direct.txt",
      mimeType: "text/plain",
      sizeBytes: 11,
      sha256:
        "6e5bc8df28cfac06658769974f895070db24676563ebc1ae17fb961f5da4d5e9",
    });
    const refreshedUploadSession = await client.fileUploadSession("file 1");
    const completedUpload = await client.completeFileUploadSession("file 1");
    const resumableUploadSession =
      await client.createFileResumableUploadSession({
        workspaceId: "workspace 1",
        fileName: "resumable.txt",
        mimeType: "text/plain",
        sizeBytes: 11,
        sha256:
          "6e5bc8df28cfac06658769974f895070db24676563ebc1ae17fb961f5da4d5e9",
        partSizeBytes: 6,
      });
    const refreshedResumableUploadSession =
      await client.fileResumableUploadSession("file 1");
    const completedResumableUpload =
      await client.completeFileResumableUploadSession("file 1");
    const listed = await client.files.list("workspace 1");
    const fetched = await client.file("file 1");
    const bytes = await client.fileContent("file 1");
    const cancelledUpload = await client.cancelFileUploadSession("file 1");
    const cancelledResumableUpload =
      await client.cancelFileResumableUploadSession("file 1");
    const deleted = await client.deleteFile("file 1");

    expect(created.id).toBe("file_1");
    expect(uploadSession.file.status).toBe("uploading");
    expect(refreshedUploadSession.upload.method).toBe("PUT");
    expect(completedUpload.id).toBe("file_1");
    expect(resumableUploadSession.upload.mode).toBe(
      "resumable_backend_composed",
    );
    expect(refreshedResumableUploadSession.upload.parts[1]?.sizeBytes).toBe(5);
    expect(completedResumableUpload.status).toBe("available");
    expect(listed[0]?.id).toBe("file_1");
    expect(fetched.id).toBe("file_1");
    expect(new TextDecoder().decode(bytes)).toBe("hello files");
    expect(cancelledUpload.id).toBe("file_1");
    expect(cancelledResumableUpload.status).toBe("deleted");
    expect(deleted.id).toBe("file_1");
    expect(calls.map((call) => call.url)).toEqual([
      "https://romeo.example/api/v1/files",
      "https://romeo.example/api/v1/files/uploads",
      "https://romeo.example/api/v1/files/uploads/file%201",
      "https://romeo.example/api/v1/files/uploads/file%201/complete",
      "https://romeo.example/api/v1/files/uploads/resumable",
      "https://romeo.example/api/v1/files/uploads/resumable/file%201",
      "https://romeo.example/api/v1/files/uploads/resumable/file%201/complete",
      "https://romeo.example/api/v1/files?workspaceId=workspace+1",
      "https://romeo.example/api/v1/files/file%201",
      "https://romeo.example/api/v1/files/file%201/content",
      "https://romeo.example/api/v1/files/uploads/file%201",
      "https://romeo.example/api/v1/files/uploads/resumable/file%201",
      "https://romeo.example/api/v1/files/file%201",
    ]);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        workspaceId: "workspace 1",
        fileName: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 11,
        dataBase64: "aGVsbG8gZmlsZXM=",
      }),
    );
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        workspaceId: "workspace 1",
        fileName: "direct.txt",
        mimeType: "text/plain",
        sizeBytes: 11,
        sha256:
          "6e5bc8df28cfac06658769974f895070db24676563ebc1ae17fb961f5da4d5e9",
      }),
    );
    expect(calls[3]?.init?.method).toBe("POST");
    expect(calls[4]?.init?.method).toBe("POST");
    expect(calls[4]?.init?.body).toBe(
      JSON.stringify({
        workspaceId: "workspace 1",
        fileName: "resumable.txt",
        mimeType: "text/plain",
        sizeBytes: 11,
        sha256:
          "6e5bc8df28cfac06658769974f895070db24676563ebc1ae17fb961f5da4d5e9",
        partSizeBytes: 6,
      }),
    );
    expect(calls[6]?.init?.method).toBe("POST");
    expect(calls[10]?.init?.method).toBe("DELETE");
    expect(calls[11]?.init?.method).toBe("DELETE");
    expect(calls[12]?.init?.method).toBe("DELETE");
  });

  it("supports OpenAI-compatible model discovery", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        if (String(input).includes("/api/v1/openai/models/")) {
          return jsonResponse({
            id: "gpt-compatible",
            object: "model",
            created: 0,
            owned_by: "openai-compatible",
          });
        }
        return jsonResponse({
          object: "list",
          data: [
            {
              id: "gpt-compatible",
              object: "model",
              created: 0,
              owned_by: "openai-compatible",
            },
          ],
        });
      },
    });

    const response = await client.openAiModels();
    const model = await client.openAiModel("gpt/compatible");
    await client.compatibility.models();
    await client.compatibility.model("gpt-compatible");

    expect(response.object).toBe("list");
    expect(response.data[0]?.id).toBe("gpt-compatible");
    expect(model.object).toBe("model");
    expect(model.id).toBe("gpt-compatible");
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/openai/models");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/openai/models/gpt%2Fcompatible",
    );
    expect(calls[1]?.init?.method).toBe("GET");
    expect(calls[2]?.url).toBe("https://romeo.example/api/v1/openai/models");
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/openai/models/gpt-compatible",
    );
  });

  it("supports OpenAI-compatible chat completions", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          id: "chatcmpl_1",
          object: "chat.completion",
          created: 1_782_558_800,
          model: "gpt-compatible",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "Hello" },
            },
          ],
          usage: {
            prompt_tokens: 4,
            completion_tokens: 1,
            total_tokens: 5,
          },
        });
      },
    });

    const response = await client.chatCompletions({
      model: "gpt-compatible",
      messages: [{ role: "user", content: "Hello" }],
    });
    await client.compatibility.chatCompletions({
      model: "gpt-compatible",
      messages: [{ role: "system", content: "Be concise." }],
    });

    expect(response.object).toBe("chat.completion");
    expect(response.choices[0]?.message.content).toBe("Hello");
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/chat/completions");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        model: "gpt-compatible",
        messages: [{ role: "user", content: "Hello" }],
      }),
    );
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/chat/completions");
  });

  it("supports OpenWebUI-compatible boot metadata", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        const path = String(input);
        if (path.endsWith("/api/v1/openwebui/config")) {
          return jsonResponse({
            status: true,
            name: "Romeo",
            version: "0.1.0",
            default_locale: "en-US",
            oauth: { providers: {}, auto_redirect: false },
            features: {
              auth: true,
              auth_trusted_header: false,
              enable_signup_password_confirmation: false,
              enable_ldap: false,
              enable_signup: false,
              enable_login_form: true,
              enable_websocket: false,
              enable_api_keys: true,
              enable_password_change_form: false,
              enable_version_update_check: false,
              enable_public_active_users_count: false,
              enable_easter_eggs: false,
              enable_direct_connections: false,
              enable_folders: true,
              folder_max_file_count: 100,
              enable_channels: false,
              enable_calendar: false,
              enable_automations: true,
              enable_notes: false,
              enable_web_search: false,
              enable_code_execution: false,
              enable_code_interpreter: false,
              enable_image_generation: false,
              enable_autocomplete_generation: false,
              enable_community_sharing: false,
              enable_message_rating: false,
              enable_user_webhooks: true,
              enable_user_status: false,
              enable_admin_export: true,
              enable_admin_chat_access: false,
              enable_admin_analytics: true,
              enable_google_drive_integration: false,
              enable_onedrive_integration: false,
              enable_memories: false,
            },
            default_models: [],
            default_pinned_models: [],
            default_prompt_suggestions: [],
            code: { engine: "disabled", interpreter_engine: "disabled" },
            audio: {
              tts: {
                engine: "romeo",
                voice: "Romeo Neutral",
                split_on: "punctuation",
              },
              stt: { engine: "romeo" },
            },
            file: {
              max_size: 10485760,
              max_count: 20,
              image_compression: { width: 1600, height: 1600 },
            },
            permissions: {},
            ui: {
              pending_user_overlay_title: "",
              pending_user_overlay_content: "",
              response_watermark: "",
              iframe_csp: "",
            },
            license_metadata: null,
          });
        }
        if (path.endsWith("/api/v1/auths/")) {
          return jsonResponse({
            token: null,
            token_type: "Bearer",
            expires_at: null,
            id: "user_dev_admin",
            email: "admin@romeo.local",
            name: "Romeo Admin",
            role: "admin",
            profile_image_url: "",
            permissions: {
              workspace: { models: true },
              features: { api_keys: true },
              chat: { temporary: true },
              sharing: { public_chats: false },
              settings: { interface: true },
              access_grants: { allow_users: false },
            },
            bio: null,
            gender: null,
            date_of_birth: null,
            status_emoji: "",
            status_message: "",
            status_expires_at: null,
          });
        }
        if (path.endsWith("/api/v1/openwebui/version/updates")) {
          return jsonResponse({ current: "0.1.0", latest: "0.1.0" });
        }
        return jsonResponse({ version: "0.1.0", deployment_id: "romeo" });
      },
    });

    const config = await client.openWebUiConfig();
    const sessionUser = await client.openWebUiSessionUser();
    const version = await client.openWebUiVersion();
    const updates = await client.openWebUiVersionUpdates();
    await client.compatibility.openWebUiConfig();
    await client.compatibility.openWebUiSessionUser();
    await client.compatibility.openWebUiVersion();
    await client.compatibility.openWebUiVersionUpdates();

    expect(config.status).toBe(true);
    expect(config.features.enable_folders).toBe(true);
    expect(sessionUser.token).toBeNull();
    expect(sessionUser.role).toBe("admin");
    expect(version.deployment_id).toBe("romeo");
    expect(updates.current).toBe("0.1.0");
    expect(calls.map((call) => call.url)).toEqual([
      "https://romeo.example/api/v1/openwebui/config",
      "https://romeo.example/api/v1/auths/",
      "https://romeo.example/api/v1/openwebui/version",
      "https://romeo.example/api/v1/openwebui/version/updates",
      "https://romeo.example/api/v1/openwebui/config",
      "https://romeo.example/api/v1/auths/",
      "https://romeo.example/api/v1/openwebui/version",
      "https://romeo.example/api/v1/openwebui/version/updates",
    ]);
    expect(calls.every((call) => call.init?.method === "GET")).toBe(true);
  });

  it("supports OpenWebUI-compatible chat, folder, and channel resources", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        const url = new URL(String(input));
        if (url.pathname.endsWith("/api/v1/chats/new")) {
          return jsonResponse({
            id: "chat_1",
            title: "Imported",
            user_id: "user_1",
            chat: { history: { messages: {}, currentId: null } },
            updated_at: 1,
            created_at: 1,
            share_id: null,
            archived: false,
            pinned: false,
            meta: {},
            folder_id: "folder_1",
            tasks: null,
            summary: null,
            last_read_at: null,
          });
        }
        if (url.pathname.endsWith("/api/v1/chats/all/archived")) {
          return jsonResponse([
            {
              id: "chat_1",
              title: "Imported",
              user_id: "user_1",
              chat: { history: { messages: {}, currentId: null } },
              updated_at: 1,
              created_at: 1,
              share_id: null,
              archived: true,
              pinned: false,
              meta: {},
              folder_id: "folder_1",
              tasks: null,
              summary: null,
              last_read_at: null,
            },
          ]);
        }
        if (
          url.pathname.endsWith("/api/v1/chats/search") ||
          url.pathname.endsWith("/api/v1/chats/archived")
        ) {
          return jsonResponse([
            {
              id: "chat_1",
              title: "Imported",
              updated_at: 1,
              created_at: 1,
              last_read_at: null,
            },
          ]);
        }
        if (url.pathname.endsWith("/api/v1/chats/all/tags")) {
          return jsonResponse([
            {
              id: "important",
              name: "important",
              user_id: "user_1",
              meta: null,
            },
          ]);
        }
        if (url.pathname.endsWith("/api/v1/chats/tags")) {
          return jsonResponse([
            {
              id: "chat_1",
              title: "Imported",
              updated_at: 1,
              created_at: 1,
              last_read_at: null,
            },
          ]);
        }
        if (url.pathname.endsWith("/api/v1/chats/chat%201/tags")) {
          return jsonResponse([
            {
              id: "important",
              name: "important",
              user_id: "user_1",
              meta: null,
            },
          ]);
        }
        if (url.pathname.endsWith("/api/v1/chats/chat%201/pinned")) {
          return jsonResponse(true);
        }
        if (url.pathname.endsWith("/api/v1/chats/chat%201/pin")) {
          return jsonResponse({
            id: "chat_1",
            title: "Imported",
            user_id: "user_1",
            chat: { history: { messages: {}, currentId: null } },
            updated_at: 1,
            created_at: 1,
            share_id: null,
            archived: false,
            pinned: true,
            meta: {},
            folder_id: null,
            tasks: null,
            summary: null,
            last_read_at: null,
          });
        }
        if (url.pathname.endsWith("/api/v1/chats/chat%201/folder")) {
          return jsonResponse({
            id: "chat_1",
            title: "Imported",
            user_id: "user_1",
            chat: { history: { messages: {}, currentId: null } },
            updated_at: 1,
            created_at: 1,
            share_id: null,
            archived: false,
            pinned: false,
            meta: {},
            folder_id: null,
            tasks: null,
            summary: null,
            last_read_at: null,
          });
        }
        if (
          url.pathname.endsWith("/api/v1/folders/") &&
          init?.method === "POST"
        ) {
          return jsonResponse({
            id: "folder_1",
            name: "Imports",
            user_id: "user_1",
            items: null,
            data: null,
            meta: null,
            parent_id: null,
            is_expanded: false,
            created_at: 1,
            updated_at: 1,
          });
        }
        if (url.pathname.includes("/api/v1/folders/folder%201")) {
          return jsonResponse({
            id: "folder_1",
            name: "Imports",
            user_id: "user_1",
            items: null,
            data: { color: "blue" },
            meta: { icon: "folder" },
            parent_id: null,
            is_expanded: true,
            created_at: 1,
            updated_at: 2,
          });
        }
        if (url.pathname.includes("/api/v1/chats/folder/")) {
          return jsonResponse([
            {
              id: "chat_1",
              title: "Imported",
              updated_at: 1,
              created_at: 1,
              last_read_at: null,
            },
          ]);
        }
        if (url.pathname.endsWith("/api/v1/folders/")) {
          return jsonResponse([
            {
              id: "folder_1",
              name: "Imports",
              meta: null,
              parent_id: null,
              is_expanded: false,
              created_at: 1,
              updated_at: 1,
            },
          ]);
        }
        if (
          url.pathname.endsWith("/api/v1/channels/channel%201/members/active")
        ) {
          return jsonResponse(true);
        }
        if (
          url.pathname.endsWith(
            "/api/v1/channels/channel%201/update/members/add",
          )
        ) {
          return jsonResponse([
            {
              id: "member_1",
              channel_id: "channel_1",
              user_id: "user_2",
              role: null,
              status: "joined",
              is_active: true,
              is_channel_muted: false,
              is_channel_pinned: false,
              data: null,
              meta: null,
              invited_at: 1,
              invited_by: "user_1",
              joined_at: 1,
              left_at: null,
              last_read_at: 1,
              created_at: 1,
              updated_at: 1,
            },
          ]);
        }
        if (
          url.pathname.endsWith(
            "/api/v1/channels/channel%201/update/members/remove",
          )
        ) {
          return jsonResponse(1);
        }
        if (url.pathname.endsWith("/api/v1/channels/channel%201/members")) {
          return jsonResponse({
            total: 2,
            users: [
              {
                id: "user_1",
                email: "one@example.com",
                name: "One",
                role: "user",
                profile_image_url: "",
                is_active: true,
                status_emoji: "",
                status_message: "",
                status_expires_at: null,
              },
            ],
          });
        }
        if (url.pathname.endsWith("/api/v1/channels/channel%201/events")) {
          return sseResponse([
            {
              event: "events:channel",
              data: {
                id: "openwebui_channel_event_1",
                channel_id: "channel_1",
                message_id: null,
                created_at: 1,
                data: { type: "channel:connected", data: {} },
                user: null,
                channel: null,
              },
            },
          ]);
        }
        if (url.pathname.endsWith("/api/v1/channels/channel%201/messages")) {
          return jsonResponse([
            {
              id: "message_1",
              user_id: "user_1",
              channel_id: "channel_1",
              reply_to_id: null,
              parent_id: null,
              is_pinned: false,
              pinned_by: null,
              pinned_at: null,
              content: "Release window is 14:00 UTC.",
              data: false,
              meta: null,
              created_at: 1,
              updated_at: 1,
              user: null,
              reply_to_message: null,
              latest_reply_at: null,
              reply_count: 0,
              reactions: [],
            },
          ]);
        }
        if (
          url.pathname.endsWith("/api/v1/channels/channel%201/messages/post")
        ) {
          return jsonResponse({
            id: "message_1",
            user_id: "user_1",
            channel_id: "channel_1",
            reply_to_id: null,
            parent_id: null,
            is_pinned: false,
            pinned_by: null,
            pinned_at: null,
            content: "Release window is 14:00 UTC.",
            data: { source: "client-test" },
            meta: null,
            created_at: 1,
            updated_at: 1,
            user: null,
            reply_to_message: null,
            latest_reply_at: null,
            reply_count: 0,
            reactions: [],
          });
        }
        if (
          url.pathname.endsWith("/api/v1/channels/channel%201/messages/read")
        ) {
          return jsonResponse(true);
        }
        if (
          url.pathname.endsWith("/api/v1/channels/channel%201/messages/pinned")
        ) {
          return jsonResponse([
            {
              id: "message_1",
              user_id: "user_1",
              channel_id: "channel_1",
              reply_to_id: null,
              parent_id: null,
              is_pinned: true,
              pinned_by: "user_1",
              pinned_at: 1,
              content: "Release window is 14:00 UTC.",
              data: false,
              meta: null,
              created_at: 1,
              updated_at: 1,
              user: null,
              reply_to_message: null,
              latest_reply_at: null,
              reply_count: 0,
              reactions: [],
            },
          ]);
        }
        if (
          url.pathname.endsWith(
            "/api/v1/channels/channel%201/messages/message%201/data",
          )
        ) {
          return jsonResponse({ source: "client-test" });
        }
        if (
          url.pathname.endsWith(
            "/api/v1/channels/channel%201/messages/message%201/thread",
          )
        ) {
          return jsonResponse([]);
        }
        if (
          url.pathname.endsWith(
            "/api/v1/channels/channel%201/messages/message%201/pin",
          ) ||
          url.pathname.endsWith(
            "/api/v1/channels/channel%201/messages/message%201/update",
          )
        ) {
          return jsonResponse({
            id: "message_1",
            user_id: "user_1",
            channel_id: "channel_1",
            reply_to_id: null,
            parent_id: null,
            is_pinned: true,
            pinned_by: "user_1",
            pinned_at: 1,
            content: "Release window is 15:00 UTC.",
            data: { source: "client-test" },
            meta: null,
            created_at: 1,
            updated_at: 2,
            user: null,
            reply_to_message: null,
            latest_reply_at: null,
            reply_count: 0,
            reactions: [],
          });
        }
        if (
          url.pathname.endsWith(
            "/api/v1/channels/channel%201/messages/message%201/reactions/add",
          ) ||
          url.pathname.endsWith(
            "/api/v1/channels/channel%201/messages/message%201/reactions/remove",
          ) ||
          url.pathname.endsWith(
            "/api/v1/channels/channel%201/messages/message%201/delete",
          )
        ) {
          return jsonResponse(true);
        }
        if (
          url.pathname.endsWith(
            "/api/v1/channels/channel%201/messages/message%201",
          )
        ) {
          return jsonResponse({
            id: "message_1",
            user_id: "user_1",
            channel_id: "channel_1",
            reply_to_id: null,
            parent_id: null,
            is_pinned: false,
            pinned_by: null,
            pinned_at: null,
            content: "Release window is 14:00 UTC.",
            data: false,
            meta: null,
            created_at: 1,
            updated_at: 1,
            user: null,
            reply_to_message: null,
            latest_reply_at: null,
            reply_count: 0,
            reactions: [],
          });
        }
        if (url.pathname.endsWith("/api/v1/channels/channel%201/delete")) {
          return jsonResponse(true);
        }
        if (
          url.pathname.endsWith("/api/v1/channels/create") ||
          url.pathname.endsWith("/api/v1/channels/users/user%202") ||
          url.pathname.endsWith("/api/v1/channels/channel%201") ||
          url.pathname.endsWith("/api/v1/channels/channel%201/update")
        ) {
          return jsonResponse({
            id: "channel_1",
            user_id: "user_1",
            type: "group",
            name: "team",
            description: null,
            is_private: true,
            data: null,
            meta: null,
            access_grants: [],
            created_at: 1,
            updated_at: 1,
            updated_by: null,
            archived_at: null,
            archived_by: null,
            deleted_at: null,
            deleted_by: null,
            last_message_at: null,
            unread_count: 0,
            user_ids: ["user_1", "user_2"],
            users: [],
            is_manager: true,
            write_access: true,
            user_count: 2,
            last_read_at: 1,
          });
        }
        if (url.pathname.endsWith("/api/v1/channels/")) {
          return jsonResponse([
            {
              id: "channel_1",
              user_id: "user_1",
              type: "group",
              name: "team",
              description: null,
              is_private: true,
              data: null,
              meta: null,
              access_grants: [],
              created_at: 1,
              updated_at: 1,
              updated_by: null,
              archived_at: null,
              archived_by: null,
              deleted_at: null,
              deleted_by: null,
              last_message_at: null,
              unread_count: 0,
            },
          ]);
        }
        return jsonResponse([]);
      },
    });

    const chats = await client.openWebUiChats({
      includeFolders: true,
      includePinned: true,
      page: 2,
    });
    const createdChat = await client.openWebUiCreateChat({
      chat: { title: "Imported" },
      folder_id: "folder_1",
    });
    const pinnedChats = await client.openWebUiPinnedChats();
    const pinnedStatus = await client.openWebUiChatPinnedStatus("chat 1");
    const toggledPin = await client.openWebUiToggleChatPinned("chat 1");
    const searchChats = await client.openWebUiSearchChats("Imported", 4);
    const archivedChats = await client.openWebUiArchivedChats(5);
    const allArchivedChats = await client.openWebUiAllArchivedChats();
    const allTags = await client.openWebUiAllTags();
    const taggedChats = await client.openWebUiChatsByTag("important");
    const chatTags = await client.openWebUiChatTags("chat 1");
    const addedChatTags = await client.openWebUiAddChatTag(
      "chat 1",
      "important",
    );
    const deletedChatTags = await client.openWebUiDeleteChatTag(
      "chat 1",
      "important",
    );
    const folderChats = await client.openWebUiFolderChats("folder 1");
    const folderChatList = await client.openWebUiFolderChatList("folder 1", 3);
    const movedChat = await client.openWebUiUpdateChatFolder("chat 1", {
      folder_id: null,
    });
    const folders = await client.openWebUiFolders();
    const createdFolder = await client.openWebUiCreateFolder({
      name: "Imports",
    });
    const folder = await client.openWebUiFolder("folder 1");
    const updatedFolder = await client.openWebUiUpdateFolder("folder 1", {
      name: "Imports Updated",
    });
    const expandedFolder = await client.openWebUiUpdateFolderExpanded(
      "folder 1",
      true,
    );
    const parentFolder = await client.openWebUiUpdateFolderParent(
      "folder 1",
      null,
    );
    const deletedFolder = await client.openWebUiDeleteFolder("folder 1", true);
    const channels = await client.openWebUiChannels();
    const createdChannel = await client.openWebUiCreateChannel({
      type: "group",
      name: "team",
      user_ids: ["user_2"],
    });
    const dmChannel = await client.openWebUiDmChannelForUser("user 2");
    const channel = await client.openWebUiChannel("channel 1");
    const channelMembers = await client.openWebUiChannelMembers("channel 1");
    const channelEventIterator = client
      .openWebUiChannelEvents("channel 1")
      [Symbol.asyncIterator]();
    const channelEvent = await channelEventIterator.next();
    await channelEventIterator.return?.();
    const channelMessages = await client.openWebUiChannelMessages("channel 1", {
      skip: 0,
      limit: 10,
    });
    const pinnedChannelMessages = await client.openWebUiPinnedChannelMessages(
      "channel 1",
      2,
    );
    const channelMessage = await client.openWebUiChannelMessage(
      "channel 1",
      "message 1",
    );
    const channelMessageData = await client.openWebUiChannelMessageData(
      "channel 1",
      "message 1",
    );
    const channelThreadMessages = await client.openWebUiChannelThreadMessages(
      "channel 1",
      "message 1",
      { skip: 0, limit: 5 },
    );
    const postedChannelMessage = await client.openWebUiPostChannelMessage(
      "channel 1",
      {
        content: "Release window is 14:00 UTC.",
        data: { source: "client-test" },
      },
    );
    const pinnedChannelMessage = await client.openWebUiPinChannelMessage(
      "channel 1",
      "message 1",
      true,
    );
    const updatedChannelMessage = await client.openWebUiUpdateChannelMessage(
      "channel 1",
      "message 1",
      { content: "Release window is 15:00 UTC." },
    );
    const addedChannelReaction =
      await client.openWebUiAddChannelMessageReaction(
        "channel 1",
        "message 1",
        "thumbs_up",
      );
    const removedChannelReaction =
      await client.openWebUiRemoveChannelMessageReaction(
        "channel 1",
        "message 1",
        "thumbs_up",
      );
    const deletedChannelMessage = await client.openWebUiDeleteChannelMessage(
      "channel 1",
      "message 1",
    );
    const channelRead = await client.openWebUiMarkChannelRead("channel 1");
    const activeChannel = await client.openWebUiUpdateChannelMemberActive(
      "channel 1",
      true,
    );
    const addedChannelMembers = await client.openWebUiAddChannelMembers(
      "channel 1",
      { user_ids: ["user_2"] },
    );
    const removedChannelMembers = await client.openWebUiRemoveChannelMembers(
      "channel 1",
      { user_ids: ["user_2"] },
    );
    const updatedChannel = await client.openWebUiUpdateChannel("channel 1", {
      name: "team-updated",
    });
    const deletedChannel = await client.openWebUiDeleteChannel("channel 1");
    await client.compatibility.openWebUiChannels();
    await client.compatibility.openWebUiCreateChannel({ name: "team" });

    expect(chats).toEqual([]);
    expect(createdChat.folder_id).toBe("folder_1");
    expect(pinnedChats).toEqual([]);
    expect(pinnedStatus).toBe(true);
    expect(toggledPin.pinned).toBe(true);
    expect(searchChats[0]?.id).toBe("chat_1");
    expect(archivedChats[0]?.id).toBe("chat_1");
    expect(allArchivedChats[0]?.archived).toBe(true);
    expect(allTags[0]?.id).toBe("important");
    expect(taggedChats[0]?.id).toBe("chat_1");
    expect(chatTags[0]?.name).toBe("important");
    expect(addedChatTags[0]?.user_id).toBe("user_1");
    expect(deletedChatTags[0]?.id).toBe("important");
    expect(folderChats[0]?.id).toBe("chat_1");
    expect(folderChatList[0]?.last_read_at).toBeNull();
    expect(movedChat.folder_id).toBeNull();
    expect(folders[0]?.name).toBe("Imports");
    expect(createdFolder.user_id).toBe("user_1");
    expect(folder.data).toEqual({ color: "blue" });
    expect(updatedFolder.meta).toEqual({ icon: "folder" });
    expect(expandedFolder.is_expanded).toBe(true);
    expect(parentFolder.parent_id).toBeNull();
    expect(deletedFolder.id).toBe("folder_1");
    expect(channels[0]?.id).toBe("channel_1");
    expect(createdChannel.write_access).toBe(true);
    expect(dmChannel.user_count).toBe(2);
    expect(channel.user_ids).toEqual(["user_1", "user_2"]);
    expect(channelMembers.total).toBe(2);
    expect(channelEvent.value).toMatchObject({
      event: "events:channel",
      data: {
        channel_id: "channel_1",
        data: { type: "channel:connected" },
      },
    });
    expect(channelMessages[0]?.content).toBe("Release window is 14:00 UTC.");
    expect(pinnedChannelMessages[0]?.is_pinned).toBe(true);
    expect(channelMessage.id).toBe("message_1");
    expect(channelMessageData).toEqual({ source: "client-test" });
    expect(channelThreadMessages).toEqual([]);
    expect(postedChannelMessage.data).toEqual({ source: "client-test" });
    expect(pinnedChannelMessage.is_pinned).toBe(true);
    expect(updatedChannelMessage.content).toBe("Release window is 15:00 UTC.");
    expect(addedChannelReaction).toBe(true);
    expect(removedChannelReaction).toBe(true);
    expect(deletedChannelMessage).toBe(true);
    expect(channelRead).toBe(true);
    expect(activeChannel).toBe(true);
    expect(addedChannelMembers[0]?.status).toBe("joined");
    expect(removedChannelMembers).toBe(1);
    expect(updatedChannel.name).toBe("team");
    expect(deletedChannel).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      "https://romeo.example/api/v1/chats/?include_folders=true&include_pinned=true&page=2",
      "https://romeo.example/api/v1/chats/new",
      "https://romeo.example/api/v1/chats/pinned",
      "https://romeo.example/api/v1/chats/chat%201/pinned",
      "https://romeo.example/api/v1/chats/chat%201/pin",
      "https://romeo.example/api/v1/chats/search?text=Imported&page=4",
      "https://romeo.example/api/v1/chats/archived?page=5",
      "https://romeo.example/api/v1/chats/all/archived",
      "https://romeo.example/api/v1/chats/all/tags",
      "https://romeo.example/api/v1/chats/tags",
      "https://romeo.example/api/v1/chats/chat%201/tags",
      "https://romeo.example/api/v1/chats/chat%201/tags",
      "https://romeo.example/api/v1/chats/chat%201/tags",
      "https://romeo.example/api/v1/chats/folder/folder%201",
      "https://romeo.example/api/v1/chats/folder/folder%201/list?page=3",
      "https://romeo.example/api/v1/chats/chat%201/folder",
      "https://romeo.example/api/v1/folders/",
      "https://romeo.example/api/v1/folders/",
      "https://romeo.example/api/v1/folders/folder%201",
      "https://romeo.example/api/v1/folders/folder%201/update",
      "https://romeo.example/api/v1/folders/folder%201/update/expanded",
      "https://romeo.example/api/v1/folders/folder%201/update/parent",
      "https://romeo.example/api/v1/folders/folder%201?delete_contents=true",
      "https://romeo.example/api/v1/channels/",
      "https://romeo.example/api/v1/channels/create",
      "https://romeo.example/api/v1/channels/users/user%202",
      "https://romeo.example/api/v1/channels/channel%201",
      "https://romeo.example/api/v1/channels/channel%201/members",
      "https://romeo.example/api/v1/channels/channel%201/events",
      "https://romeo.example/api/v1/channels/channel%201/messages?skip=0&limit=10",
      "https://romeo.example/api/v1/channels/channel%201/messages/pinned?page=2",
      "https://romeo.example/api/v1/channels/channel%201/messages/message%201",
      "https://romeo.example/api/v1/channels/channel%201/messages/message%201/data",
      "https://romeo.example/api/v1/channels/channel%201/messages/message%201/thread?skip=0&limit=5",
      "https://romeo.example/api/v1/channels/channel%201/messages/post",
      "https://romeo.example/api/v1/channels/channel%201/messages/message%201/pin",
      "https://romeo.example/api/v1/channels/channel%201/messages/message%201/update",
      "https://romeo.example/api/v1/channels/channel%201/messages/message%201/reactions/add",
      "https://romeo.example/api/v1/channels/channel%201/messages/message%201/reactions/remove",
      "https://romeo.example/api/v1/channels/channel%201/messages/message%201/delete",
      "https://romeo.example/api/v1/channels/channel%201/messages/read",
      "https://romeo.example/api/v1/channels/channel%201/members/active",
      "https://romeo.example/api/v1/channels/channel%201/update/members/add",
      "https://romeo.example/api/v1/channels/channel%201/update/members/remove",
      "https://romeo.example/api/v1/channels/channel%201/update",
      "https://romeo.example/api/v1/channels/channel%201/delete",
      "https://romeo.example/api/v1/channels/",
      "https://romeo.example/api/v1/channels/create",
    ]);
    expect(calls[28]?.init?.headers).toMatchObject({
      accept: "text/event-stream",
    });
  });

  it("supports OpenAI-compatible embeddings", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          object: "list",
          model: "text-embedding-3-small",
          data: [{ object: "embedding", index: 0, embedding: [1, 0, 0] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        });
      },
    });

    const response = await client.embeddings({
      model: "text-embedding-3-small",
      input: "Romeo",
    });
    await client.compatibility.embeddings({
      model: "text-embedding-3-small",
      input: ["Romeo", "quotas"],
    });

    expect(response.object).toBe("list");
    expect(response.data[0]?.embedding).toEqual([1, 0, 0]);
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/embeddings");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        model: "text-embedding-3-small",
        input: "Romeo",
      }),
    );
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/embeddings");
  });

  it("supports workspace create, archive, and export paths", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { id: "workspace_1" } });
      },
    });

    await client.createWorkspace({ name: "RAG Team", slug: "rag-team" });
    await client.archiveWorkspace("workspace/1");
    await client.exportWorkspace("workspace/1");

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/workspaces");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ name: "RAG Team", slug: "rag-team" }),
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/workspaces/workspace%2F1/archive",
    );
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/workspaces/workspace%2F1/export",
    );
    expect(calls[2]?.init?.method).toBe("GET");
  });

  it("updates the current user's profile through the system resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        if (calls.length === 1) {
          return jsonResponse({
            subject: {
              id: "user_dev_admin",
              type: "user",
              email: "admin@romeo.local",
              name: "Development Admin",
              orgId: "org_default",
              workspaceIds: ["workspace_default"],
              groupIds: ["group_admins"],
              scopes: ["me:read"],
              isAdmin: true,
            },
            deployment: { tenancyMode: "multi" },
            organizations: [],
            workspaces: [],
          });
        }
        return jsonResponse({
          data: {
            id: "user_dev_admin",
            orgId: "org_default",
            email: "new.admin@romeo.local",
            name: "Renamed Admin",
            role: "global_admin",
          },
        });
      },
    });

    const me = await client.me();
    const updated = await client.updateMyProfile({
      email: "new.admin@romeo.local",
      name: "Renamed Admin",
    });

    expect(me.subject.id).toBe("user_dev_admin");
    expect(me.subject.email).toBe("admin@romeo.local");
    expect(me.subject.name).toBe("Development Admin");
    expect(me.deployment.tenancyMode).toBe("multi");
    expect(updated.email).toBe("new.admin@romeo.local");
    expect(updated.name).toBe("Renamed Admin");
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/me");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/me");
    expect(calls[1]?.init?.method).toBe("PATCH");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        email: "new.admin@romeo.local",
        name: "Renamed Admin",
      }),
    );
  });

  it("manages knowledge base metadata through the knowledge resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { id: "kb_1" } });
      },
    });

    await client.knowledge.getBase("kb/1");
    await client.knowledge.updateBase("kb/1", {
      name: "Updated KB",
      description: null,
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/knowledge-bases/kb%2F1",
    );
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/knowledge-bases/kb%2F1",
    );
    expect(calls[1]?.init?.method).toBe("PATCH");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({ name: "Updated KB", description: null }),
    );
  });

  it("queries knowledge through the tiered retrieval resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            plan: {
              entries: [
                {
                  knowledgeBaseId: "kb_private",
                  orgId: "org_default",
                  workspaceId: "workspace_default",
                  tier: "user_private",
                  permissionReason: "direct_use_grant",
                  maxResults: 2,
                  sourceFilter: {
                    mode: "authorized_visible_sources",
                    connectorOwnerFiltered: true,
                  },
                  retrievalRoute: {
                    mode: "lexical_fallback",
                    vectorStoreDriver: "none",
                    externalVectorStoreAttempted: false,
                    externalVectorStoreUsed: false,
                    fallbackReason: "missing_model_scope",
                  },
                  vectorScope: {
                    driver: "pgvector",
                    isolationMode: "shared_row_scope",
                    orgId: "org_default",
                    workspaceId: "workspace_default",
                    knowledgeBaseId: "kb_private",
                  },
                },
              ],
              posture: {
                vectorDriver: "pgvector",
                isolationMode: "shared_row_scope",
                externalVectorStoreDriver: "disabled",
                externalVectorStoreConfigured: false,
                externalVectorStoreRoutingActive: false,
                namespaceConfigured: false,
                namespacePolicy: "none",
                partitioningConfigured: false,
                partitioningPolicy: "none",
              },
              policy: {
                source: "org",
                enabledTiers: ["user_private", "workspace", "org", "shared"],
                defaultMaxResultsPerTier: {
                  user_private: 5,
                  workspace: 5,
                  org: 5,
                  shared: 5,
                },
                maxResultsPerTier: {
                  user_private: 20,
                  workspace: 20,
                  org: 20,
                  shared: 20,
                },
                knowledgeBaseTierAssignments: {
                  org: [],
                  shared: [],
                },
                externalVectorStoreMode: "disabled",
              },
              requestedCount: 1,
              authorizedCount: 1,
              skipped: { count: 0, reasons: [] },
            },
            hits: [
              {
                id: "kb_chunk_1",
                content: "Romeo tiered retrieval.",
                score: 1,
                citation: {
                  documentId: "source_1",
                  chunkId: "kb_chunk_1",
                  title: "private.md",
                },
                metadata: {},
                knowledgeBaseId: "kb_private",
                orgId: "org_default",
                workspaceId: "workspace_default",
                tier: "user_private",
                permissionReason: "direct_use_grant",
                retrievalRoute: {
                  mode: "lexical_fallback",
                  vectorStoreDriver: "none",
                  externalVectorStoreAttempted: false,
                  externalVectorStoreUsed: false,
                  fallbackReason: "missing_model_scope",
                },
              },
            ],
          },
        });
      },
    });

    const result = await client.knowledge.queryTiered({
      knowledgeBaseIds: ["kb_private"],
      query: "tiered",
      maxResultsPerTier: { user_private: 2 },
    });

    expect(result.plan.entries[0]?.tier).toBe("user_private");
    expect(result.plan.entries[0]?.retrievalRoute?.fallbackReason).toBe(
      "missing_model_scope",
    );
    expect(result.hits[0]?.knowledgeBaseId).toBe("kb_private");
    expect(result.hits[0]?.retrievalRoute.mode).toBe("lexical_fallback");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/knowledge-bases/query",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        knowledgeBaseIds: ["kb_private"],
        query: "tiered",
        maxResultsPerTier: { user_private: 2 },
      }),
    );
  });

  it("replays tiered retrieval through the knowledge resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            caseCount: 1,
            cases: [
              {
                authorizedKnowledgeBaseCount: 1,
                caseId: "case_1",
                expectedChunkCount: 1,
                fallbackReasons: {},
                hitCount: 1,
                latencyMs: 7,
                matchedExpectedChunkCount: 1,
                precision: 1,
                recall: 1,
                retrievalRouteModes: {
                  external_vector: 0,
                  legacy_rag_provider: 0,
                  lexical_fallback: 1,
                  pgvector: 0,
                },
                skippedKnowledgeBaseCount: 0,
                status: "passed",
              },
            ],
            generatedAt: "2026-07-02T00:00:00.000Z",
            metrics: {
              averageLatencyMs: 7,
              averagePrecision: 1,
              averageRecall: 1,
              expectedChunkCount: 1,
              hitCount: 1,
              matchedExpectedChunkCount: 1,
            },
            orgId: "org_default",
            redaction: {
              rawQueriesReturned: false,
              rawChunkTextReturned: false,
              rawExpectedChunkIdsReturned: false,
              rawHitIdsReturned: false,
              vectorValuesReturned: false,
            },
            status: "passed",
          },
        });
      },
    });

    const result = await client.knowledge.replayTiered({
      cases: [
        {
          id: "case_1",
          knowledgeBaseIds: ["kb_private"],
          query: "tiered",
          expectedChunkIds: ["chunk_1"],
        },
      ],
    });

    expect(result.status).toBe("passed");
    expect(result.metrics.averageRecall).toBe(1);
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/admin/rag/replay");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        cases: [
          {
            id: "case_1",
            knowledgeBaseIds: ["kb_private"],
            query: "tiered",
            expectedChunkIds: ["chunk_1"],
          },
        ],
      }),
    );
  });

  it("compares tiered retrieval replay reports through the knowledge resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        const replayReport = {
          caseCount: 1,
          cases: [
            {
              authorizedKnowledgeBaseCount: 1,
              caseId: "case_1",
              expectedChunkCount: 1,
              fallbackReasons: {},
              hitCount: 1,
              latencyMs: 7,
              matchedExpectedChunkCount: 1,
              precision: 1,
              recall: 1,
              retrievalRouteModes: {
                external_vector: 0,
                legacy_rag_provider: 0,
                lexical_fallback: 1,
                pgvector: 0,
              },
              skippedKnowledgeBaseCount: 0,
              status: "passed",
            },
          ],
          generatedAt: "2026-07-02T00:00:00.000Z",
          metrics: {
            averageLatencyMs: 7,
            averagePrecision: 1,
            averageRecall: 1,
            expectedChunkCount: 1,
            hitCount: 1,
            matchedExpectedChunkCount: 1,
          },
          orgId: "org_default",
          redaction: {
            rawQueriesReturned: false,
            rawChunkTextReturned: false,
            rawExpectedChunkIdsReturned: false,
            rawHitIdsReturned: false,
            vectorValuesReturned: false,
          },
          status: "passed",
        };
        return jsonResponse({
          data: {
            baseline: replayReport,
            candidate: replayReport,
            deltas: {
              averageLatencyMs: 0,
              averagePrecision: 0,
              averageRecall: 0,
              expectedChunkCount: 0,
              hitCount: 0,
              matchedExpectedChunkCount: 0,
            },
            generatedAt: "2026-07-02T00:00:01.000Z",
            orgId: "org_default",
            outcome: "unchanged",
            redaction: {
              rawQueriesReturned: false,
              rawChunkTextReturned: false,
              rawExpectedChunkIdsReturned: false,
              rawHitIdsReturned: false,
              vectorValuesReturned: false,
            },
          },
        });
      },
    });

    const result = await client.knowledge.compareTieredReplay({
      baseline: [
        {
          id: "baseline",
          knowledgeBaseIds: ["kb_private"],
          query: "tiered",
          expectedChunkIds: ["chunk_1"],
        },
      ],
      candidate: [
        {
          id: "candidate",
          knowledgeBaseIds: ["kb_private"],
          query: "tiered",
          expectedChunkIds: ["chunk_1"],
          maxResultsPerTier: { user_private: 2 },
        },
      ],
    });

    expect(result.outcome).toBe("unchanged");
    expect(result.deltas.averageRecall).toBe(0);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/rag/replay/compare",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        baseline: [
          {
            id: "baseline",
            knowledgeBaseIds: ["kb_private"],
            query: "tiered",
            expectedChunkIds: ["chunk_1"],
          },
        ],
        candidate: [
          {
            id: "candidate",
            knowledgeBaseIds: ["kb_private"],
            query: "tiered",
            expectedChunkIds: ["chunk_1"],
            maxResultsPerTier: { user_private: 2 },
          },
        ],
      }),
    );
  });

  it("requests usage CSV as text", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return new Response("metric,quantity\nrun.started,1\n", {
          status: 200,
          headers: { "content-type": "text/csv" },
        });
      },
    });

    const csv = await client.admin.usageEventsCsv();

    expect(csv).toContain("run.started");
    expect(calls[0]?.init?.headers).toMatchObject({ accept: "text/csv" });
  });

  it("creates webhook subscriptions through the webhook resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            subscription: {
              id: "webhook_1",
              url: "https://hooks.example/romeo",
              eventTypes: ["run.completed"],
            },
            signingSecret: "whsec_test",
          },
        });
      },
    });

    const created = await client.webhooks.create({
      url: "https://hooks.example/romeo",
      eventTypes: ["run.completed"],
    });

    expect(created.signingSecret).toBe("whsec_test");
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/webhooks");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        url: "https://hooks.example/romeo",
        eventTypes: ["run.completed"],
      }),
    );
  });

  it("retries due webhook deliveries through the webhook resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: { job: { id: "job_1", status: "completed" }, deliveries: [] },
        });
      },
    });

    const result = await client.webhooks.retryDue();

    expect(result.job.status).toBe("completed");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/webhook-deliveries/retry-due",
    );
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("supports governance and filtered audit paths", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: [] });
      },
    });

    await client.admin.auditLogs({
      action: "api_key.create",
      outcome: "success",
    });
    await client.governance.accessReview();
    await client.governance.accessReviewCsv();
    await client.governance.accessReviewReport();
    await client.governance.identityLifecyclePolicy();
    await client.identityLifecyclePolicy();
    await client.governance.accessReviewReportCsv();
    await client.governance.enforceRetention();
    await client.governance.previewDataDeletion({
      resourceType: "chat",
      resourceId: "chat_1",
    });
    await client.governance.executeDataDeletion({
      resourceType: "chat",
      resourceId: "chat_1",
      confirmResourceId: "chat_1",
    });
    await client.governance.previewDataDeletion({
      resourceType: "file_object",
      resourceId: "file_1",
    });
    await client.governance.executeDataDeletion({
      resourceType: "file_object",
      resourceId: "file_1",
      confirmResourceId: "file_1",
    });
    await client.governance.previewDataDeletion({
      resourceType: "knowledge_source",
      resourceId: "kb_source_1",
    });
    await client.governance.executeDataDeletion({
      resourceType: "knowledge_source",
      resourceId: "kb_source_1",
      confirmResourceId: "kb_source_1",
    });
    await client.governance.dataRightsCoverage();
    await client.governance.previewDataExport({
      scope: "workspace",
      workspaceId: "workspace_1",
    });
    await client.governance.executeDataExport({
      scope: "workspace",
      workspaceId: "workspace_1",
      includeContent: true,
      includeObjectBytes: true,
      maxObjectBytes: 1024,
    });
    await client.governance.createDataExportPackage({
      scope: "workspace",
      workspaceId: "workspace_1",
      includeContent: true,
    });
    await client.governance.listDataExportPackages();
    await client.governance.downloadDataExportPackage(
      "export_pkg_0123456789abcdef0123",
    );
    await client.governance.deleteDataExportPackage(
      "export_pkg_0123456789abcdef0123",
      { confirmPackageId: "export_pkg_0123456789abcdef0123" },
    );
    await client.governance.complianceReport();
    await client.governance.complianceReportCsv();

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/audit-logs?action=api_key.create&outcome=success",
    );
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/access-review");
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/access-review.csv",
    );
    expect(calls[2]?.init?.headers).toMatchObject({ accept: "text/csv" });
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/access-review/report",
    );
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/governance/identity-lifecycle-policy",
    );
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/governance/identity-lifecycle-policy",
    );
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/access-review/report.csv",
    );
    expect(calls[6]?.init?.headers).toMatchObject({ accept: "text/csv" });
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/governance/retention/enforce",
    );
    expect(calls[7]?.init?.method).toBe("POST");
    expect(calls[8]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-deletions/preview",
    );
    expect(calls[8]?.init?.body).toBe(
      JSON.stringify({ resourceType: "chat", resourceId: "chat_1" }),
    );
    expect(calls[9]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-deletions/execute",
    );
    expect(calls[9]?.init?.body).toBe(
      JSON.stringify({
        resourceType: "chat",
        resourceId: "chat_1",
        confirmResourceId: "chat_1",
      }),
    );
    expect(calls[10]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-deletions/preview",
    );
    expect(calls[10]?.init?.body).toBe(
      JSON.stringify({ resourceType: "file_object", resourceId: "file_1" }),
    );
    expect(calls[11]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-deletions/execute",
    );
    expect(calls[11]?.init?.body).toBe(
      JSON.stringify({
        resourceType: "file_object",
        resourceId: "file_1",
        confirmResourceId: "file_1",
      }),
    );
    expect(calls[12]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-deletions/preview",
    );
    expect(calls[12]?.init?.body).toBe(
      JSON.stringify({
        resourceType: "knowledge_source",
        resourceId: "kb_source_1",
      }),
    );
    expect(calls[13]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-deletions/execute",
    );
    expect(calls[13]?.init?.body).toBe(
      JSON.stringify({
        resourceType: "knowledge_source",
        resourceId: "kb_source_1",
        confirmResourceId: "kb_source_1",
      }),
    );
    expect(calls[14]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-rights/coverage",
    );
    expect(calls[15]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-exports/preview",
    );
    expect(calls[15]?.init?.body).toBe(
      JSON.stringify({ scope: "workspace", workspaceId: "workspace_1" }),
    );
    expect(calls[16]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-exports/execute",
    );
    expect(calls[16]?.init?.body).toBe(
      JSON.stringify({
        scope: "workspace",
        workspaceId: "workspace_1",
        includeContent: true,
        includeObjectBytes: true,
        maxObjectBytes: 1024,
      }),
    );
    expect(calls[17]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-exports/packages",
    );
    expect(calls[17]?.init?.body).toBe(
      JSON.stringify({
        scope: "workspace",
        workspaceId: "workspace_1",
        includeContent: true,
      }),
    );
    expect(calls[18]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-exports/packages",
    );
    expect(calls[18]?.init?.method).toBe("GET");
    expect(calls[19]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-exports/packages/export_pkg_0123456789abcdef0123/content",
    );
    expect(calls[19]?.init?.headers).toMatchObject({
      accept: "application/json",
    });
    expect(calls[20]?.url).toBe(
      "https://romeo.example/api/v1/governance/data-exports/packages/export_pkg_0123456789abcdef0123",
    );
    expect(calls[20]?.init?.method).toBe("DELETE");
    expect(calls[20]?.init?.body).toBe(
      JSON.stringify({ confirmPackageId: "export_pkg_0123456789abcdef0123" }),
    );
    expect(calls[21]?.url).toBe(
      "https://romeo.example/api/v1/governance/compliance-report",
    );
    expect(calls[22]?.url).toBe(
      "https://romeo.example/api/v1/governance/compliance-report.csv",
    );
    expect(calls[22]?.init?.headers).toMatchObject({ accept: "text/csv" });
  });

  it("reads production readiness through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: { status: "attention_required", generatedAt: "", checks: [] },
        });
      },
    });

    const report = await client.admin.readiness();

    expect(report.status).toBe("attention_required");
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/admin/readiness");
  });

  it("reads edge security posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            status: "ready",
            generatedAt: "2026-07-02T00:00:00.000Z",
            orgId: "org_default",
            appOrigin: { configured: true, localhost: false, scheme: "https" },
            tls: {
              appOriginHttps: true,
              hstsEnabled: true,
              hstsIncludeSubdomains: true,
              hstsMaxAgeSeconds: 31536000,
              hstsPreload: false,
              termination: "ingress",
            },
            proxy: {
              mode: "trusted_proxy",
              forwardedHeadersTrusted: true,
            },
            ingress: {
              allowedOriginRuleCount: 1,
              wafMode: "block",
            },
            limits: {
              files: {
                directUploadMaxBytes: 100000000,
                inlineMaxBytes: 25000000,
                messageAttachmentMaxBytes: 5000000,
              },
              rateLimit: {
                authenticatedMax: 6000,
                authMax: 60,
                distributed: true,
                driver: "valkey",
                publicMax: 600,
                webhookMax: 1200,
                windowSeconds: 60,
              },
              requestBodyMaxBytes: 50000000,
            },
            headers: {
              contentTypeOptions: "nosniff",
              crossOriginOpenerPolicy: "same-origin",
              frameOptions: "DENY",
              permissionsPolicy: "camera=(), microphone=(), geolocation=()",
              referrerPolicy: "no-referrer",
              strictTransportSecurity: true,
            },
            liveEvidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.live-edge-enforcement.v1",
              generatedAt: "2026-07-02T03:00:00.000Z",
              evidenceStatus: "passed",
              mode: "live",
              failureCodes: [],
              target: {
                deployment: "edge",
                originConfigured: true,
              },
              checks: {
                total: 7,
                requiredTotal: 5,
                requiredPresent: 5,
                missingRequired: [],
              },
              securityHeaders: {
                checked: true,
                status: "passed",
                matchedRequiredCount: 5,
                missingRequiredCount: 0,
                hstsChecked: true,
                headerValuesReturned: false,
              },
              waf: {
                checked: true,
                status: "passed",
                httpStatus: 403,
                expectedStatusCount: 3,
                expectedHeaderPresent: true,
                responseBodyReturned: false,
              },
              requestBodyLimit: {
                checked: true,
                status: "passed",
                bytesSent: 1048576,
                httpStatus: 413,
                expectedStatusCount: 1,
                requestBodyReturned: false,
                responseBodyReturned: false,
              },
              rateLimit: {
                checked: true,
                status: "passed",
                attempts: 8,
                blockedAt: 8,
                expectedStatus: 429,
                responseBodyReturned: false,
              },
              redaction: {
                rawApiKeyReturned: false,
                rawHeaderValuesReturned: false,
                rawProbePayloadReturned: false,
                rawQueryValuesReturned: false,
                rawRequestBodiesReturned: false,
                rawResponseBodiesReturned: false,
              },
            },
            checks: [],
            redaction: {
              evidenceFileBodyReturned: false,
              rawAllowedOriginsReturned: false,
              rawAppOriginReturned: false,
              rawEvidencePathReturned: false,
              rawIngressAnnotationsReturned: false,
              rawProxyIpRangesReturned: false,
              rawSecretsReturned: false,
            },
          },
        });
      },
    });

    const report = await client.admin.edgeSecurityPosture();

    expect(report.status).toBe("ready");
    expect(report.ingress.wafMode).toBe("block");
    expect(report.limits.files.inlineMaxBytes).toBe(25000000);
    expect(report.limits.rateLimit.driver).toBe("valkey");
    expect(report.limits.rateLimit.distributed).toBe(true);
    expect(report.limits.requestBodyMaxBytes).toBe(50000000);
    expect(report.liveEvidence.status).toBe("satisfied");
    expect(report.liveEvidence.waf.httpStatus).toBe(403);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/edge-security/posture",
    );
  });

  it("reads sanitized RAG posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            generatedAt: "2026-07-01T00:00:00.000Z",
            orgId: "org_default",
            status: "degraded",
            vector: {
              driver: "pgvector",
              authoritativeStore: "postgres",
              isolationMode: "shared_row_scope",
              pgvectorConfigured: true,
              externalVectorStoreConfigured: false,
              qdrantConfigured: false,
              namespaceConfigured: false,
              partitioningConfigured: false,
              postureSource: "deployment_default",
              externalStore: {
                driver: "disabled",
                endpointConfigured: false,
                collectionConfigured: false,
                credentialRefConfigured: false,
                credentialRefValid: false,
                namespacePolicy: "none",
                partitioningPolicy: "none",
                configured: false,
                routingActive: false,
                evidence: {
                  configured: false,
                  status: "not_configured",
                  collectionHealthRead: false,
                  scopedQueryReturnedExpectedPoint: false,
                  namespaceTrapExcluded: false,
                  partitionTrapExcluded: false,
                  foreignOrgTrapExcluded: false,
                  vectorsOmittedFromQuery: false,
                  scopedDeleteVerified: false,
                  cleanupAttempted: false,
                  redaction: {
                    apiKeyReturned: false,
                    collectionReturned: false,
                    endpointReturned: false,
                    evidenceFileBodyReturned: false,
                    namespaceValuesReturned: false,
                    partitionValuesReturned: false,
                    payloadValuesReturned: false,
                    pointIdsReturned: false,
                    rawEvidencePathReturned: false,
                    vectorValuesReturned: false,
                  },
                },
              },
              physicalIsolation: {
                policy: {
                  mode: "external_namespace_per_org",
                  enforcement: "required",
                  configured: true,
                  postgresAuthoritative: true,
                  liveEvidenceRequired: true,
                },
                deploymentMode: "shared_row_scope",
                deploymentMatched: false,
                evidence: {
                  configured: false,
                  status: "not_configured",
                  tablePartitioned: false,
                  partitionKeyIncludesOrgId: false,
                  partitionCount: 0,
                  hnswIndexCount: 0,
                  queryPlanReviewed: false,
                  redaction: {
                    databaseUrlReturned: false,
                    evidenceFileBodyReturned: false,
                    rawEvidencePathReturned: false,
                    rawSqlReturned: false,
                    vectorValuesReturned: false,
                  },
                },
                externalVectorEvidence: {
                  configured: false,
                  status: "not_configured",
                  collectionHealthRead: false,
                  scopedQueryReturnedExpectedPoint: false,
                  namespaceTrapExcluded: false,
                  partitionTrapExcluded: false,
                  foreignOrgTrapExcluded: false,
                  vectorsOmittedFromQuery: false,
                  scopedDeleteVerified: false,
                  cleanupAttempted: false,
                  redaction: {
                    apiKeyReturned: false,
                    collectionReturned: false,
                    endpointReturned: false,
                    evidenceFileBodyReturned: false,
                    namespaceValuesReturned: false,
                    partitionValuesReturned: false,
                    payloadValuesReturned: false,
                    pointIdsReturned: false,
                    rawEvidencePathReturned: false,
                    vectorValuesReturned: false,
                  },
                },
                status: "deployment_mismatch",
              },
            },
            corpus: {
              workspaceCount: 1,
              knowledgeBaseCount: 1,
              sourceCount: 2,
              indexedSourceCount: 1,
              pendingSourceCount: 1,
              failedSourceCount: 0,
              chunkCount: 3,
              embeddingCount: 1,
              embeddedChunkCount: 1,
              chunksMissingProviderEmbeddingCount: 2,
              staleEmbeddingRecordCount: 0,
              staleSourceCount: 0,
              providerModelIndexCount: 1,
            },
            jobs: {
              failedEmbeddingIndexJobCount: 0,
              failedExtractionJobCount: 0,
              failedReindexJobCount: 0,
              queuedKnowledgeJobCount: 1,
              runningKnowledgeJobCount: 0,
            },
            fallback: {
              lexicalFallbackAvailable: true,
              degraded: true,
              reasonCodes: [
                "shared_pgvector_default",
                "partial_provider_embedding_coverage",
              ],
            },
            readiness: {
              warnings: [
                {
                  code: "lexical_fallback_active",
                  count: 2,
                  severity: "info",
                },
                {
                  code: "physical_vector_isolation_mismatch",
                  count: 1,
                  severity: "warning",
                },
              ],
            },
          },
        });
      },
    });

    const report = await client.admin.ragPosture();

    expect(report.vector.driver).toBe("pgvector");
    expect(report.vector.authoritativeStore).toBe("postgres");
    expect(report.fallback.reasonCodes).toContain(
      "partial_provider_embedding_coverage",
    );
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/rag/posture",
    );
  });

  it("reads and updates RAG policy through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            orgId: "org_default",
            source: "org",
            enabledTiers: ["workspace"],
            defaultMaxResultsPerTier: {
              user_private: 5,
              workspace: 2,
              org: 5,
              shared: 5,
            },
            maxResultsPerTier: {
              user_private: 20,
              workspace: 2,
              org: 20,
              shared: 20,
            },
            allowedEmbeddingProviderModels: [
              {
                providerId: "provider_openai",
                model: "text-embedding-3-small",
              },
            ],
            knowledgeBaseTierAssignments: {
              org: ["kb_org"],
              shared: ["kb_shared"],
            },
            dataResidencyTags: ["us"],
            externalVectorStore: {
              mode: "deployment_managed",
              namespacePolicy: "org",
              partitioningPolicy: "workspace",
              configured: true,
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
            enforcement: {
              tierBudgets: "enforced",
              embeddingProviderModelAllowlist: "enforced",
            },
          },
        });
      },
    });

    const policy = await client.admin.ragPolicy();
    const updated = await client.admin.updateRagPolicy({
      enabledTiers: ["workspace"],
      maxResultsPerTier: { workspace: 2 },
      knowledgeBaseTierAssignments: { org: ["kb_org"] },
      externalVectorStore: {
        mode: "deployment_managed",
        namespacePolicy: "org",
        partitioningPolicy: "workspace",
        drStrategy: "postgres_authoritative_reindex",
        exportPolicy: "metadata_only",
      },
      physicalVectorIsolation: {
        mode: "external_namespace_per_org",
        enforcement: "required",
      },
    });
    await client.admin.ragPolicyChangeRequest();
    await client.admin.createRagPolicyChangeRequest({
      policy: {
        enabledTiers: ["workspace"],
        maxResultsPerTier: { workspace: 2 },
      },
      justificationCode: "retrieval_replay_improvement",
      evidenceSummary: {
        replayCaseCount: 12,
        averagePrecision: 0.81,
        averageRecall: 0.76,
        averageLatencyMs: 42,
        beforeAfterComparisonAttached: true,
      },
    });
    await client.admin.approveRagPolicyChangeRequest("rag/change request", {
      confirmRequestId: "rag/change request",
    });
    await client.admin.rejectRagPolicyChangeRequest("rag/change request", {
      confirmRequestId: "rag/change request",
      reasonCode: "superseded",
    });

    expect(policy.enabledTiers).toEqual(["workspace"]);
    expect(policy.knowledgeBaseTierAssignments.shared).toEqual(["kb_shared"]);
    expect(policy.externalVectorStore).toMatchObject({
      mode: "deployment_managed",
      namespacePolicy: "org",
      partitioningPolicy: "workspace",
      configured: true,
      restoreValidation: "required_when_enabled",
    });
    expect(policy.physicalVectorIsolation).toMatchObject({
      mode: "external_namespace_per_org",
      enforcement: "required",
      liveEvidenceRequired: true,
    });
    expect(updated.maxResultsPerTier.workspace).toBe(2);
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/admin/rag/policy");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/admin/rag/policy");
    expect(calls[1]?.init?.method).toBe("PATCH");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        enabledTiers: ["workspace"],
        maxResultsPerTier: { workspace: 2 },
        knowledgeBaseTierAssignments: { org: ["kb_org"] },
        externalVectorStore: {
          mode: "deployment_managed",
          namespacePolicy: "org",
          partitioningPolicy: "workspace",
          drStrategy: "postgres_authoritative_reindex",
          exportPolicy: "metadata_only",
        },
        physicalVectorIsolation: {
          mode: "external_namespace_per_org",
          enforcement: "required",
        },
      }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/admin/rag/policy/change-request",
    );
    expect(calls[2]?.init?.method).toBe("GET");
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/admin/rag/policy/change-requests",
    );
    expect(calls[3]?.init?.method).toBe("POST");
    expect(calls[3]?.init?.body).toBe(
      JSON.stringify({
        policy: {
          enabledTiers: ["workspace"],
          maxResultsPerTier: { workspace: 2 },
        },
        justificationCode: "retrieval_replay_improvement",
        evidenceSummary: {
          replayCaseCount: 12,
          averagePrecision: 0.81,
          averageRecall: 0.76,
          averageLatencyMs: 42,
          beforeAfterComparisonAttached: true,
        },
      }),
    );
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/admin/rag/policy/change-requests/rag%2Fchange%20request/approve",
    );
    expect(calls[4]?.init?.method).toBe("POST");
    expect(calls[4]?.init?.body).toBe(
      JSON.stringify({ confirmRequestId: "rag/change request" }),
    );
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/admin/rag/policy/change-requests/rag%2Fchange%20request/reject",
    );
    expect(calls[5]?.init?.method).toBe("POST");
    expect(calls[5]?.init?.body).toBe(
      JSON.stringify({
        confirmRequestId: "rag/change request",
        reasonCode: "superseded",
      }),
    );
  });

  it("reads background job operational summaries through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            generatedAt: "2026-06-30T00:00:00.000Z",
            status: "degraded",
            thresholds: {
              deadLetterCriticalCount: 5,
              deadLetterWarningCount: 1,
              queuedWarningSeconds: 300,
              queuedCriticalSeconds: 900,
              runningWarningSeconds: 900,
              runningCriticalSeconds: 3600,
              failedLookbackSeconds: 3600,
              failedWarningCount: 1,
              failedCriticalCount: 5,
            },
            totals: {
              total: 1,
              queued: 1,
              running: 0,
              completed: 0,
              failed: 0,
              deadLettered: 0,
              recentFailed: 0,
            },
            byType: [
              {
                type: "tool.operation.dispatch_request",
                total: 1,
                queued: 1,
                running: 0,
                completed: 0,
                failed: 0,
                deadLettered: 0,
                recentFailed: 0,
                oldestQueuedAgeSeconds: 360,
                oldestQueuedJobId: "job_1",
              },
            ],
            alerts: [
              {
                id: "job_queued_lag_tool_operation_dispatch_request",
                metric: "queued_lag_seconds",
                severity: "warning",
                type: "tool.operation.dispatch_request",
                value: 360,
                threshold: 300,
                jobId: "job_1",
              },
            ],
          },
        });
      },
    });

    const summary = await client.admin.jobOperationalSummary();

    expect(summary.status).toBe("degraded");
    expect(summary.alerts[0]?.metric).toBe("queued_lag_seconds");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/jobs/operational-summary",
    );
  });

  it("reads provider operational summaries through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            alerts: [
              {
                code: "provider_kill_switch",
                id: "provider_provider_kill_switch_provider_openai",
                providerId: "provider_openai",
                severity: "warning",
              },
            ],
            fallback: {
              available: true,
              configured: true,
              modelId: "model_fallback",
              providerId: "provider_fallback",
            },
            generatedAt: "2026-06-30T00:00:00.000Z",
            policy: {
              circuitCooldownMs: 60000,
              circuitFailureThreshold: 5,
              disabledProviderIds: ["provider_openai"],
              fallbackModelId: "model_fallback",
              retryAttempts: 1,
              retryBackoffMs: 250,
              streamTimeoutMs: 60000,
            },
            providers: [
              {
                circuit: { consecutiveFailures: 0, state: "closed" },
                enabled: true,
                enabledModelCount: 1,
                killSwitchActive: true,
                modelCount: 1,
                providerId: "provider_openai",
                reasons: ["provider_kill_switch"],
                status: "unavailable",
                type: "openai-compatible",
              },
            ],
            status: "degraded",
          },
        });
      },
    });

    const summary = await client.admin.providerOperationalSummary();

    expect(summary.status).toBe("degraded");
    expect(summary.fallback.providerId).toBe("provider_fallback");
    expect(summary.alerts[0]?.code).toBe("provider_kill_switch");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/providers/operational-summary",
    );
  });

  it("reads provider outage posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.provider-outage-posture.v1",
            generatedAt: "2026-07-06T00:00:00.000Z",
            orgId: "org_default",
            status: "ready",
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.provider-outage-evidence.v1",
              evidenceStatus: "passed",
              mode: "live",
              deployment: "kubernetes",
              failureCodes: [],
            },
            checks: {
              total: 9,
              requiredTotal: 9,
              requiredPresent: 9,
              missingRequired: [],
            },
            drill: {
              providerCount: 1,
              outageInjectedCount: 1,
              timeoutObservedCount: 1,
            },
            runtime: {
              circuitOpenCount: 1,
              fallbackRoutedCount: 1,
              killSwitchVerifiedCount: 1,
            },
            operationalSummary: {
              checked: true,
              degradedProviderCount: 1,
              circuitOpenProviderCount: 1,
              fallbackAvailable: true,
              killSwitchActiveCount: 1,
              alertCodeCount: 1,
            },
            alerting: {
              checked: true,
              status: "passed",
              providerAlertCount: 1,
              firingRequiredCount: 1,
            },
            recovery: {
              checked: true,
              recoveredProviderCount: 1,
              recoverySeconds: 60,
            },
            redaction: {
              evidenceFileBodyReturned: false,
              rawAlertPayloadsReturned: false,
              rawApiKeysReturned: false,
              rawEvidencePathsReturned: false,
              rawPromptsReturned: false,
              rawProviderErrorsReturned: false,
              rawProviderPayloadsReturned: false,
              rawProviderResponsesReturned: false,
              secretValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const report = await client.admin.providerOutagePosture();

    expect(report.schema).toBe("romeo.provider-outage-posture.v1");
    expect(report.status).toBe("ready");
    expect(report.operationalSummary.fallbackAvailable).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/providers/outage-posture",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads identity live posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.identity-live-posture.v1",
            generatedAt: "2026-07-06T00:00:00.000Z",
            orgId: "org_default",
            status: "ready",
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.identity-live-evidence.v1",
              evidenceStatus: "passed",
              mode: "live",
              deployment: "kubernetes",
              failureCodes: [],
            },
            checks: {
              total: 10,
              requiredTotal: 10,
              requiredPresent: 10,
              missingRequired: [],
            },
            identityProviders: {
              configuredProviderCount: 2,
              liveLoginProviderCount: 2,
              oidcProviderCount: 1,
              oauth2ProviderCount: 0,
              ldapProviderCount: 1,
              samlProviderCount: 0,
              localFallbackVerified: true,
              mfaFallbackVerified: true,
            },
            secretBackends: {
              managedSecretBackendCount: 1,
              vaultSecretWriteCount: 1,
              externalSecretReferenceCount: 1,
              secretResolutionCheckCount: 1,
            },
            directory: {
              directoryProviderCount: 1,
              directoryLookupCount: 1,
              mappedGroupCount: 1,
              workspaceMappingCount: 1,
              directorySyncPreviewChangeCount: 1,
              directorySyncAppliedChangeCount: 1,
              policyViolationCount: 0,
            },
            lifecycle: {
              deprovisionedUserCount: 1,
              scimUserLifecycleCount: 1,
              scimGroupLifecycleCount: 1,
              disabledUserCount: 1,
              revokedSessionCount: 1,
            },
            accessReview: {
              checked: true,
              reportUserCount: 1,
              reportGroupCount: 1,
              reportGrantCount: 1,
              exportedCsv: true,
            },
            redaction: {
              evidenceFileBodiesReturned: false,
              rawDirectoryEntriesReturned: false,
              rawEmailAddressesReturned: false,
              rawEvidencePathsReturned: false,
              rawGroupNamesReturned: false,
              rawIdpResponsesReturned: false,
              rawLdapDnsReturned: false,
              rawProviderEndpointsReturned: false,
              rawSamlAssertionsReturned: false,
              rawSecretRefsReturned: false,
              secretValuesReturned: false,
              tokenValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const posture = await client.admin.identityLivePosture();

    expect(posture.schema).toBe("romeo.identity-live-posture.v1");
    expect(posture.status).toBe("ready");
    expect(posture.identityProviders.liveLoginProviderCount).toBe(2);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/identity/live-posture",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads analytics authz posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.analytics-authz-posture.v1",
            generatedAt: "2026-07-06T00:00:00.000Z",
            orgId: "org_default",
            status: "ready",
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.analytics-authz-live-evidence.v1",
              evidenceStatus: "passed",
              mode: "live",
              deployment: "target",
              failureCodes: [],
            },
            checks: {
              total: 12,
              requiredTotal: 12,
              requiredPresent: 12,
              missingRequired: [],
            },
            subjects: {
              adminSubjectCount: 1,
              orgAdminSubjectCount: 1,
              nonAdminSubjectCount: 1,
              serviceAccountSubjectCount: 1,
              crossOrgSubjectCount: 1,
            },
            authorization: {
              adminSummaryAllowedCount: 1,
              adminCsvAllowedCount: 1,
              nonAdminSummaryDeniedCount: 1,
              nonAdminCsvDeniedCount: 1,
              missingUsageScopeDeniedCount: 1,
              evalGrantDeniedCount: 1,
              crossOrgDeniedCount: 1,
              crossWorkspaceScopedCount: 1,
            },
            analytics: {
              summaryReadCount: 1,
              csvExportReadCount: 1,
              evalEvidenceReadCount: 1,
              csvSha256Count: 1,
              usageMetricCount: 1,
              evalSuiteCount: 1,
              jobSummaryCount: 1,
              providerSummaryCount: 1,
            },
            redaction: {
              apiKeysReturned: false,
              evidenceFileBodiesReturned: false,
              rawAnalyticsCsvRowsReturned: false,
              rawEvalInputsReturned: false,
              rawEvalOutputsReturned: false,
              rawEvidencePathsReturned: false,
              rawHumanRatingCommentsReturned: false,
              rawJobPayloadsReturned: false,
              rawOrgNamesReturned: false,
              rawProviderConfigReturned: false,
              rawSecretRefsReturned: false,
              rawToolInputsReturned: false,
              rawUsageMetadataReturned: false,
              rawUserEmailsReturned: false,
              rawWorkspaceNamesReturned: false,
              secretValuesReturned: false,
              tokenValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const posture = await client.admin.analyticsAuthzPosture();

    expect(posture.schema).toBe("romeo.analytics-authz-posture.v1");
    expect(posture.status).toBe("ready");
    expect(posture.authorization.crossOrgDeniedCount).toBe(1);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/analytics/authz-posture",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads migration drill posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.migration-drill-posture.v1",
            generatedAt: "2026-07-06T00:00:00.000Z",
            orgId: "org_default",
            status: "ready",
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.migration-drill-evidence.v1",
              evidenceStatus: "passed",
              mode: "live",
              deployment: "kubernetes",
              failureCodes: [],
            },
            checks: {
              total: 8,
              requiredTotal: 8,
              requiredPresent: 8,
              missingRequired: [],
            },
            drill: {
              attemptedMigrationCount: 1,
              failedMigrationCount: 1,
              failureInjected: true,
              cutoverBlocked: true,
            },
            job: {
              migrationJobObserved: true,
              failedClosed: true,
              retryAttemptCount: 1,
              rollbackAttemptCount: 1,
            },
            validation: {
              rollbackOrRetryVerified: true,
              schemaValidationPassed: true,
              appReadinessPassed: true,
              postRecoveryMigrationCount: 1,
            },
            runbook: {
              reviewed: true,
              recoveryDocumented: true,
              reviewerCount: 2,
            },
            redaction: {
              databaseUrlsReturned: false,
              evidenceFileBodyReturned: false,
              migrationLogsReturned: false,
              migrationSqlReturned: false,
              rawErrorStacksReturned: false,
              rawEvidencePathsReturned: false,
              secretValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const report = await client.admin.migrationDrillPosture();

    expect(report.schema).toBe("romeo.migration-drill-posture.v1");
    expect(report.status).toBe("ready");
    expect(report.validation.schemaValidationPassed).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/migrations/drill-posture",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads network partition posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.network-partition-posture.v1",
            generatedAt: "2026-07-06T00:00:00.000Z",
            orgId: "org_default",
            status: "ready",
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.network-partition-evidence.v1",
              evidenceStatus: "passed",
              mode: "live",
              deployment: "kubernetes",
              failureCodes: [],
            },
            checks: {
              total: 8,
              requiredTotal: 8,
              requiredPresent: 8,
              missingRequired: [],
            },
            drill: {
              partitionInjected: true,
              partitionedDependencyCount: 2,
              partitionedServiceCount: 1,
              partitionDurationSeconds: 60,
            },
            runtime: {
              apiDegraded: true,
              failClosedCount: 2,
              backpressureObserved: true,
              workerStormPrevented: true,
            },
            recovery: {
              checked: true,
              recoveredDependencyCount: 2,
              recoverySeconds: 45,
              postRecoveryReadbackPassed: true,
            },
            alerting: {
              checked: true,
              status: "passed",
              partitionAlertCount: 1,
              firingRequiredCount: 1,
            },
            networkContext: {
              cniConfirmed: true,
              networkPolicyApplied: true,
              namespaceScoped: true,
              egressPolicyCount: 1,
            },
            redaction: {
              evidenceFileBodyReturned: false,
              rawEvidencePathsReturned: false,
              rawLogLinesReturned: false,
              rawNetworkEndpointsReturned: false,
              rawPacketCapturesReturned: false,
              rawPodIpsReturned: false,
              secretValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const report = await client.admin.networkPartitionPosture();

    expect(report.schema).toBe("romeo.network-partition-posture.v1");
    expect(report.status).toBe("ready");
    expect(report.networkContext.cniConfirmed).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/network/partition-posture",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads secret rotation drill posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.secret-rotation-drill-posture.v1",
            generatedAt: "2026-07-06T00:00:00.000Z",
            orgId: "org_default",
            status: "ready",
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.secret-rotation-drill-evidence.v1",
              evidenceStatus: "passed",
              mode: "live",
              deployment: "kubernetes",
              failureCodes: [],
            },
            checks: {
              total: 10,
              requiredTotal: 10,
              requiredPresent: 10,
              missingRequired: [],
            },
            stagedCutover: {
              sessionSecretStaged: true,
              webhookSigningKeyCutover: true,
              apiOrServiceKeyContinuityVerified: true,
            },
            rewrap: {
              localMfaPreviewPassed: true,
              localMfaRewrappedCount: 2,
              managedSecretsPreviewPassed: true,
              managedSecretsRewrappedCount: 3,
              failureCount: 0,
            },
            acceptance: {
              oldSecretRetiredOrRejectedCount: 2,
              newSecretAcceptedCount: 2,
            },
            dependencies: {
              databaseCredentialsReviewed: true,
              objectStoreCredentialsReviewed: true,
              providerCredentialCount: 1,
              connectorCredentialCount: 1,
            },
            readiness: {
              checked: true,
              readinessPassed: true,
              postRotationLoginPassed: true,
              postRotationWebhookPassed: true,
            },
            alerting: {
              checked: true,
              status: "passed",
              rotationAlertCount: 1,
              firingRequiredCount: 1,
            },
            redaction: {
              evidenceFileBodyReturned: false,
              keyMaterialReturned: false,
              rawApiKeysReturned: false,
              rawEvidencePathsReturned: false,
              rawLogLinesReturned: false,
              rawSecretRefsReturned: false,
              rawSecretValuesReturned: false,
              rawTokensReturned: false,
              webhookSigningSecretsReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const report = await client.admin.secretRotationDrillPosture();

    expect(report.schema).toBe("romeo.secret-rotation-drill-posture.v1");
    expect(report.status).toBe("ready");
    expect(report.stagedCutover.sessionSecretStaged).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/secret-rotation/drill-posture",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads admin analytics summaries and CSV exports through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        const url = new URL(String(input));
        if (url.pathname.endsWith("/api/v1/admin/analytics/summary.csv")) {
          return new Response(
            "category,dimension,id,metric,value\noverall,org,org_default,status,healthy\n",
            { headers: { "content-type": "text/csv" } },
          );
        }
        return jsonResponse({
          data: {
            evals: {
              agentCount: 1,
              agents: [
                {
                  agentId: "agent_default",
                  workspaceId: "workspace_default",
                  latestStatus: "passed",
                  runCount: 1,
                  suiteCount: 1,
                },
              ],
              averageLatestScore: 1,
              byModel: [
                {
                  averageScore: 1,
                  failedRunCount: 0,
                  modelId: "model_openai",
                  passedRunCount: 1,
                  runCount: 1,
                },
              ],
              failedSuiteCount: 0,
              generatedRunCount: 1,
              missingSuiteCount: 0,
              passedSuiteCount: 1,
              releaseGate: {
                failedSuiteCount: 0,
                missingSuiteCount: 0,
                requiredSuiteCount: 1,
                status: "passed",
              },
              status: "passed",
              suiteCount: 1,
              suites: [
                {
                  suiteId: "eval_suite_1",
                  agentId: "agent_default",
                  workspaceId: "workspace_default",
                  latestStatus: "passed",
                  runCount: 1,
                },
              ],
            },
            generatedAt: "2026-07-02T00:00:00.000Z",
            jobs: {
              alertCount: 0,
              completed: 0,
              criticalAlertCount: 0,
              deadLettered: 0,
              failed: 0,
              queued: 0,
              running: 0,
              status: "healthy",
              total: 0,
            },
            orgId: "org_default",
            providers: {
              alertCount: 0,
              availableProviderCount: 1,
              criticalAlertCount: 0,
              degradedProviderCount: 0,
              providerCount: 1,
              status: "healthy",
              unavailableProviderCount: 0,
            },
            redaction: {
              rawEvalInputsReturned: false,
              rawEvalOutputsReturned: false,
              rawJobPayloadsReturned: false,
              rawProviderConfigReturned: false,
              rawToolInputsReturned: false,
              rawUsageMetadataReturned: false,
            },
            status: "healthy",
            tools: {
              approvalRequiredCount: 0,
              blockedCount: 0,
              byTool: [],
              failureCount: 0,
              pendingApprovalCount: 0,
              successCount: 0,
              totalCount: 0,
            },
            usage: {
              byProvider: [],
              eventCount: 0,
              estimatedCostUsd: 0,
              totals: [],
            },
          },
        });
      },
    });

    const summary = await client.admin.analyticsSummary();
    const csv = await client.admin.analyticsSummaryCsv();

    expect(summary.status).toBe("healthy");
    expect(summary.evals.releaseGate.status).toBe("passed");
    expect(csv).toContain("overall,org,org_default,status,healthy");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/analytics/summary",
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/admin/analytics/summary.csv",
    );
  });

  it("reads Postgres operational posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.postgres-operational-posture.v1",
            generatedAt: "2026-07-02T00:00:00.000Z",
            orgId: "org_default",
            status: "attention_required",
            repository: {
              driver: "postgres",
              databaseUrlConfigured: true,
              postgresRequiredForProduction: true,
            },
            pool: {
              maxConnectionsPerProcess: 10,
              source: "POSTGRES_POOL_MAX",
              sizingGuide: "docs/deployment-sizing.md",
              budgetFormula:
                "app_max_replicas * POSTGRES_POOL_MAX + maintenance + workers + scaler <= usable_database_connections",
            },
            queryPlanReview: {
              evidenceSchema: "romeo.postgres-query-plan-review.v1",
              command: "pnpm review:postgres-query-plans",
              reviewedPathCount: 21,
              requiredIndexCount: 22,
              categories: ["billing", "retrieval"],
              checks: [
                {
                  id: "knowledge_embedding_vector_search",
                  category: "retrieval",
                  expectedIndexCount: 2,
                },
              ],
              representativeVolumeEvidence: {
                requiredForGa: true,
                status: "required",
                evidenceSource: "not_configured",
                configured: false,
                representativeVolume: false,
                missingExpectedIndexCount: 0,
                failedCheckCount: 0,
              },
            },
            slowQueryTelemetry: {
              requiredForProduction: true,
              status: "external_required",
              expectedSignals: ["statement latency percentile"],
              evidence: {
                configured: false,
                fingerprintCount: 0,
                slowQueryCount: 0,
                totalCalls: 0,
                tempFileStatementCount: 0,
                failureCodes: [],
              },
            },
            lockTelemetry: {
              requiredForProduction: true,
              status: "external_required",
              expectedSignals: ["blocked session count"],
              evidence: {
                configured: false,
                blockedSessionMax: 0,
                deadlockCount: 0,
                failureCodes: [],
              },
            },
            archivalPartitioning: {
              status: "decision_required",
              currentDecision: "no_runtime_partitioning_enabled",
              migrationPolicy: "one_forward_migration_after_live_evidence",
              decisionInputs: ["representative query plans"],
              evidence: {
                configured: false,
                tableCount: 0,
                failureCodes: [],
              },
            },
            redaction: {
              databaseUrlReturned: false,
              evidenceFileBodiesReturned: false,
              lockStatementReturned: false,
              queryParameterValuesReturned: false,
              rawSqlReturned: false,
              rawEvidencePathsReturned: false,
              rowDataReturned: false,
              secretValuesReturned: false,
              telemetrySampleSqlReturned: false,
            },
            warnings: [
              "representative_query_plan_evidence_required",
              "slow_query_telemetry_required",
            ],
          },
        });
      },
    });

    const posture = await client.admin.postgresOperationalPosture();

    expect(posture.status).toBe("attention_required");
    expect(posture.queryPlanReview.reviewedPathCount).toBe(21);
    expect(posture.redaction.databaseUrlReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/postgres/operational-posture",
    );
  });

  it("reads GA evidence posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.ga-evidence-posture.v1",
            generatedAt: "2026-07-02T00:00:00.000Z",
            orgId: "org_default",
            status: "attention_required",
            checklist: {
              configured: true,
              source: "configured_file",
              status: "blocked",
              schemaVersion: "romeo.ga-checklist.v1",
              generatedAt: "2026-07-02T00:00:00.000Z",
              strict: false,
              target: {
                profile: "full-product-enterprise",
                fullProductEnterpriseRequired: true,
                deploymentTiers: ["compose", "kubernetes"],
                postgresModes: ["cloudnativepg", "external-hosted-postgres"],
                qdrantLiveRequired: true,
                qdrantDrRequired: false,
                ciGovernanceLiveRequired: false,
                kedaRequired: false,
                browserAutomationRequired: false,
                identityLiveRequired: false,
                dataConnectorLiveRequired: false,
                toolDispatchLiveRequired: false,
                voiceProviderLiveRequired: true,
                notificationAdapterLiveRequired: true,
                analyticsAuthzLiveRequired: false,
                targetQualityVectorComparisonRequired: false,
                dataRightsRetentionLiveRequired: false,
                billingOperationsLiveRequired: false,
                auditIntegrityLiveRequired: false,
                tenantPurgeLiveRequired: false,
                supportBundleLiveRequired: false,
                targetResilienceDrillsRequired: false,
                postgresOperationsLiveRequired: false,
              },
              summary: {
                total: 23,
                satisfied: 15,
                excepted: 0,
                blocked: 8,
                environmentRequired: 8,
                securityCriticalBlocked: 4,
              },
              exceptionCount: 0,
            },
            targetPreflight: {
              configured: true,
              source: "configured_file",
              status: "blocked",
              schemaVersion: "romeo.ga-target-preflight.v1",
              generatedAt: "2026-07-02T00:05:00.000Z",
              checklist: {
                status: "blocked",
                schemaVersion: "romeo.ga-checklist.v1",
                summary: {
                  total: 23,
                  satisfied: 15,
                  excepted: 0,
                  blocked: 8,
                  environmentRequired: 8,
                  securityCriticalBlocked: 4,
                },
              },
              summary: {
                total: 1,
                ready: 0,
                blocked: 1,
                securityCriticalBlocked: 0,
              },
              gates: [
                {
                  id: "phase21.kubernetes_live_smoke",
                  phase: "21",
                  title: "Kubernetes live namespace smoke",
                  status: "blocked",
                  environmentRequired: true,
                  securityCritical: false,
                  evidence: [
                    {
                      path: "dist/ci/kubernetes-live-smoke.json",
                      status: "missing",
                    },
                  ],
                  command:
                    "pnpm smoke:kubernetes:live -- --output dist/ci/kubernetes-live-smoke.json",
                  checks: [
                    {
                      name: "kubernetes_cluster",
                      status: "blocked",
                      reason: "cluster_unreachable",
                      context: "rancher-desktop",
                    },
                  ],
                  notes: [],
                },
              ],
            },
            targetPlan: {
              configured: true,
              source: "configured_file",
              status: "blocked",
              schemaVersion: "romeo.ga-target-evidence-plan.v1",
              generatedAt: "2026-07-02T00:06:00.000Z",
              sourcePreflight: {
                schemaVersion: "romeo.ga-target-preflight.v1",
                status: "blocked",
                checklist: {
                  status: "blocked",
                  schemaVersion: "romeo.ga-checklist.v1",
                  summary: {
                    total: 23,
                    satisfied: 15,
                    excepted: 0,
                    blocked: 8,
                    environmentRequired: 8,
                    securityCriticalBlocked: 4,
                  },
                },
              },
              summary: {
                total: 1,
                ready: 0,
                blocked: 1,
                environmentRequired: 1,
                securityCriticalBlocked: 0,
                phaseCount: 1,
                commandCount: 1,
                evidenceTargetCount: 1,
                blockedCheckCount: 1,
              },
              phases: [
                {
                  phase: "21",
                  status: "blocked",
                  total: 1,
                  ready: 0,
                  blocked: 1,
                  securityCriticalBlocked: 0,
                  gateIds: ["phase21.kubernetes_live_smoke"],
                },
              ],
              gates: [
                {
                  order: 1,
                  id: "phase21.kubernetes_live_smoke",
                  phase: "21",
                  title: "Kubernetes live namespace smoke",
                  status: "blocked",
                  environmentRequired: true,
                  securityCritical: false,
                  command:
                    "pnpm smoke:kubernetes:live -- --output dist/ci/kubernetes-live-smoke.json",
                  commandRedacted: false,
                  operatorAction: {
                    state: "blocked_on_prerequisites",
                    commandAvailable: true,
                    prerequisiteBlocked: true,
                    blockedReasonCodes: ["cluster_unreachable"],
                  },
                  evidenceTargets: [
                    {
                      path: "dist/ci/kubernetes-live-smoke.json",
                      status: "missing",
                    },
                  ],
                  requiredCommands: ["kubectl", "helm"],
                  requiredEnvironment: ["ROMEO_API_KEY"],
                  anyOfEnvironment: [],
                  optionalEnvironment: ["KUBERNETES_LIVE_SMOKE_TIMEOUT_MS"],
                  requiredFiles: [],
                  checks: {
                    total: 1,
                    ready: 0,
                    blocked: 1,
                    optional: 0,
                    unknown: 0,
                    blockedReasons: ["cluster_unreachable"],
                  },
                  blockedChecks: [
                    {
                      name: "kubernetes_cluster",
                      reason: "cluster_unreachable",
                    },
                  ],
                  notes: ["Use reviewed digest-pinned images."],
                },
              ],
            },
            targetExecution: {
              configured: true,
              source: "configured_file",
              status: "blocked",
              schemaVersion: "romeo.ga-target-execution.v1",
              generatedAt: "2026-07-02T00:07:00.000Z",
              sourcePlan: {
                schemaVersion: "romeo.ga-target-evidence-plan.v1",
                status: "blocked",
                checklist: {
                  status: "blocked",
                  schemaVersion: "romeo.ga-checklist.v1",
                  summary: {
                    total: 23,
                    satisfied: 15,
                    excepted: 0,
                    blocked: 8,
                    environmentRequired: 8,
                    securityCriticalBlocked: 4,
                  },
                },
              },
              execution: {
                confirmed: false,
                continueOnFailure: false,
                timeoutMs: 3600000,
                selectedGateCount: 1,
                commandsExecuted: 0,
              },
              envFile: {
                configured: true,
                loaded: true,
                variableCount: 2,
                populatedVariableCount: 1,
                blankVariableCount: 1,
                duplicateCount: 0,
                appliedVariableCount: 1,
                variableNames: ["ROMEO_API_KEY", "KUBERNETES_NAMESPACE"],
                warningCodes: [],
                rawValuesReturned: false,
                rawFileBodyReturned: false,
                shellSourced: false,
                blankValuesApplied: false,
              },
              summary: {
                total: 1,
                readyToRun: 0,
                executed: 0,
                passed: 0,
                failed: 0,
                skipped: 1,
                confirmationRequired: 0,
                blocked: 1,
                redacted: 0,
                commandMissing: 0,
              },
              gates: [
                {
                  id: "phase21.kubernetes_live_smoke",
                  phase: "21",
                  title: "Kubernetes live namespace smoke",
                  targetStatus: "blocked",
                  operatorActionState: "blocked_on_prerequisites",
                  commandHash:
                    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
                  commandAvailable: true,
                  commandRedacted: false,
                  executionStatus: "skipped",
                  skippedReason: "preflight_not_ready",
                  startedAt: "2026-07-02T00:07:00.000Z",
                  completedAt: "2026-07-02T00:07:00.000Z",
                  durationMs: 0,
                  evidenceTargets: [
                    {
                      path: "dist/ci/kubernetes-live-smoke.json",
                      status: "missing",
                    },
                  ],
                  blockedReasonCodes: ["cluster_unreachable"],
                },
              ],
            },
            bundle: {
              configured: true,
              source: "configured_file",
              status: "blocked",
              schemaVersion: "romeo.ga-evidence-bundle.v1",
              generatedAt: "2026-07-02T00:10:00.000Z",
              requirements: {
                checklistPassed: true,
                readbackValidation: true,
                supportBundle: true,
                supportRedaction: true,
                docsCommandCheck: true,
                tenantIsolation: true,
              },
              release: {
                name: "romeo",
                version: "1.2.3",
                artifactCount: 4,
              },
              ga: {
                status: "blocked",
                strict: false,
                summary: {
                  total: 23,
                  satisfied: 15,
                  excepted: 0,
                  blocked: 8,
                  environmentRequired: 8,
                  securityCriticalBlocked: 4,
                },
                profile: "full-product-enterprise",
                fullProductEnterpriseRequired: true,
                qdrantDrRequired: false,
                qdrantLiveRequired: true,
                ciGovernanceLiveRequired: false,
                kedaRequired: false,
                browserAutomationRequired: false,
                identityLiveRequired: false,
                dataConnectorLiveRequired: false,
                toolDispatchLiveRequired: false,
                voiceProviderLiveRequired: true,
                notificationAdapterLiveRequired: true,
                analyticsAuthzLiveRequired: false,
                targetQualityVectorComparisonRequired: false,
                dataRightsRetentionLiveRequired: false,
                billingOperationsLiveRequired: false,
                auditIntegrityLiveRequired: false,
                tenantPurgeLiveRequired: false,
                supportBundleLiveRequired: false,
                targetResilienceDrillsRequired: false,
                postgresOperationsLiveRequired: false,
                blockedGateIds: ["phase21.kubernetes_live_smoke"],
                exceptionCount: 0,
              },
              inventory: {
                evidenceFileCount: 12,
                totalBytes: 3456,
                sha256:
                  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
              },
              checks: {
                total: 20,
                passed: 19,
                failed: 1,
              },
              blockerCount: 1,
              blockerCodes: ["ga_checklist_not_passed"],
              redaction: {
                evidenceBodiesIncluded: false,
                exceptionRationaleIncluded: false,
                rawEvidencePathsIncluded: false,
                rawSecretsIncluded: false,
                rawLogsIncluded: false,
                rawPromptsIncluded: false,
                rawProviderPayloadsIncluded: false,
                rawConnectorPayloadsIncluded: false,
              },
            },
            gates: [
              {
                id: "phase21.kubernetes_live_smoke",
                phase: "21",
                title: "Kubernetes live namespace smoke",
                status: "blocked",
                requiredForGa: true,
                exceptionAllowed: false,
                environmentRequired: true,
                securityCritical: false,
                evidence: [
                  {
                    path: "dist/ci/kubernetes-live-smoke.json",
                    status: "missing",
                    failureCodes: [],
                  },
                ],
              },
            ],
            requiredLiveBlockers: [
              {
                id: "phase21.kubernetes_live_smoke",
                phase: "21",
                title: "Kubernetes live namespace smoke",
                securityCritical: false,
              },
            ],
            liveGateReadiness: [
              {
                id: "phase21.kubernetes_live_smoke",
                phase: "21",
                title: "Kubernetes live namespace smoke",
                securityCritical: false,
                checklistStatus: "blocked",
                preflightStatus: "blocked",
                command:
                  "pnpm smoke:kubernetes:live -- --output dist/ci/kubernetes-live-smoke.json",
                checklistEvidence: {
                  total: 1,
                  satisfied: 0,
                  missing: 1,
                  failed: 0,
                  invalid: 0,
                  unknown: 0,
                },
                preflightEvidence: {
                  total: 1,
                  ready: 0,
                  missing: 1,
                  blocked: 0,
                  failed: 0,
                  unknown: 0,
                },
                checks: {
                  total: 1,
                  ready: 0,
                  blocked: 1,
                  optional: 0,
                  unknown: 0,
                  blockedReasons: ["cluster_unreachable"],
                },
                warnings: ["preflight_blocked", "live_evidence_missing"],
              },
            ],
            redaction: {
              absoluteChecklistPathReturned: false,
              absoluteBundlePathReturned: false,
              bundleBlockerMessagesReturned: false,
              bundleEvidenceFileBodiesReturned: false,
              bundleEvidencePathsReturned: false,
              evidenceFileBodiesReturned: false,
              exceptionApproverReturned: false,
              exceptionOwnerReturned: false,
              exceptionRationaleReturned: false,
              preflightCommandOutputReturned: false,
              preflightEnvironmentValuesReturned: false,
              preflightFileBodiesReturned: false,
              targetPlanCommandOutputReturned: false,
              targetPlanEnvironmentValuesReturned: false,
              targetPlanEvidenceBodiesReturned: false,
              targetExecutionCommandTextReturned: false,
              targetExecutionCommandOutputReturned: false,
              targetExecutionEnvironmentValuesReturned: false,
              targetExecutionEnvFileValuesReturned: false,
              targetExecutionEnvFileBodyReturned: false,
              targetExecutionEvidenceBodiesReturned: false,
              rawEvidencePathsReturned: false,
              rawPreflightEvidencePathsReturned: false,
              rawTargetPlanEvidencePathsReturned: false,
              rawTargetExecutionEvidencePathsReturned: false,
            },
            warnings: [
              "ga_blocked",
              "live_environment_evidence_required",
              "ga_target_preflight_blocked",
              "ga_bundle_blocked",
            ],
          },
        });
      },
    });

    const posture = await client.admin.gaEvidencePosture();

    expect(posture.checklist.summary.blocked).toBe(8);
    expect(posture.checklist.target).toMatchObject({
      profile: "full-product-enterprise",
      fullProductEnterpriseRequired: true,
      qdrantLiveRequired: true,
      voiceProviderLiveRequired: true,
      notificationAdapterLiveRequired: true,
    });
    expect(posture.targetPreflight.status).toBe("blocked");
    expect(posture.targetPreflight.gates[0]?.checks[0]?.reason).toBe(
      "cluster_unreachable",
    );
    expect(posture.targetPlan.status).toBe("blocked");
    expect(posture.targetPlan.summary.blockedCheckCount).toBe(1);
    expect(posture.targetPlan.gates[0]?.requiredCommands).toEqual([
      "kubectl",
      "helm",
    ]);
    expect(posture.targetPlan.gates[0]?.evidenceTargets[0]?.path).toBe(
      "dist/ci/kubernetes-live-smoke.json",
    );
    expect(posture.targetPlan.gates[0]?.operatorAction).toMatchObject({
      state: "blocked_on_prerequisites",
      prerequisiteBlocked: true,
      blockedReasonCodes: ["cluster_unreachable"],
    });
    expect(posture.targetExecution.status).toBe("blocked");
    expect(posture.targetExecution.execution.commandsExecuted).toBe(0);
    expect(posture.targetExecution.envFile.populatedVariableCount).toBe(1);
    expect(posture.targetExecution.envFile.rawValuesReturned).toBe(false);
    expect(posture.targetExecution.summary.skipped).toBe(1);
    expect(posture.targetExecution.gates[0]?.commandHash).toBe(
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    );
    expect(posture.targetExecution.gates[0]?.executionStatus).toBe("skipped");
    expect(posture.bundle.status).toBe("blocked");
    expect(posture.bundle.release?.version).toBe("1.2.3");
    expect(posture.bundle.ga).toMatchObject({
      profile: "full-product-enterprise",
      fullProductEnterpriseRequired: true,
      qdrantLiveRequired: true,
      voiceProviderLiveRequired: true,
      notificationAdapterLiveRequired: true,
    });
    expect(posture.bundle.checks.failed).toBe(1);
    expect(posture.bundle.blockerCodes).toEqual(["ga_checklist_not_passed"]);
    expect(posture.requiredLiveBlockers[0]?.id).toBe(
      "phase21.kubernetes_live_smoke",
    );
    expect(posture.liveGateReadiness[0]).toMatchObject({
      id: "phase21.kubernetes_live_smoke",
      preflightStatus: "blocked",
      checklistEvidence: { missing: 1 },
      checks: { blockedReasons: ["cluster_unreachable"] },
    });
    expect(posture.redaction.evidenceFileBodiesReturned).toBe(false);
    expect(posture.redaction.targetPlanEnvironmentValuesReturned).toBe(false);
    expect(posture.redaction.targetExecutionCommandOutputReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/ga/evidence-posture",
    );
  });

  it("reads target quality posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.target-quality-posture.v1",
            generatedAt: "2026-07-02T01:00:00.000Z",
            orgId: "org_default",
            status: "ready",
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.target-quality-evidence.v1",
              generatedAt: "2026-07-02T00:59:00.000Z",
              evidenceStatus: "passed",
              mode: "live",
              failureCodes: [],
            },
            target: {
              deployment: "target-api",
              originConfigured: true,
            },
            checks: {
              total: 10,
              requiredTotal: 10,
              requiredPresent: 10,
              missingRequired: [],
            },
            health: {
              checked: true,
              status: "ok",
              bodyBytes: 24,
            },
            analytics: {
              status: "passed",
              summaryStatus: "healthy",
              evalStatus: "healthy",
              evalSuiteCount: 2,
              evalRunCount: 4,
              usageEventCount: 12,
              providerStatus: "healthy",
              jobStatus: "healthy",
              toolCallCount: 8,
              csvBytes: 256,
              csvSha256Present: true,
              redactionPassed: true,
            },
            evals: {
              reportCount: 1,
              passedReportCount: 1,
              gatePassedCount: 1,
              publishBlockedCount: 0,
              failedSuiteCount: 0,
              missingSuiteCount: 0,
              reasonCodes: ["eval_gate_passed"],
              redactionPassed: true,
            },
            replay: {
              checked: true,
              status: "passed",
              kind: "single",
              replayStatus: "passed",
              caseCount: 3,
              matchedExpectedChunkCount: 2,
              averagePrecision: 0.8,
              averageRecall: 0.75,
              routeModeCounts: {
                single: {
                  external_vector: 0,
                  legacy_rag_provider: 0,
                  lexical_fallback: 0,
                  pgvector: 3,
                },
              },
              redactionPassed: true,
            },
            redaction: {
              evidenceFileBodyReturned: false,
              rawAnalyticsCsvReturned: false,
              rawEvalAgentIdsReturned: false,
              rawEvalInputsReturned: false,
              rawEvalOutputsReturned: false,
              rawEvalWorkspaceIdsReturned: false,
              rawEvidencePathReturned: false,
              rawReplayHitIdsReturned: false,
              rawReplayQueriesReturned: false,
              rawSecretsReturned: false,
              rawTargetUrlReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const posture = await client.admin.targetQualityPosture();

    expect(posture.status).toBe("ready");
    expect(posture.evidence.status).toBe("satisfied");
    expect(posture.evals.gatePassedCount).toBe(1);
    expect(posture.replay.caseCount).toBe(3);
    expect(posture.redaction.rawAnalyticsCsvReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/target-quality/posture",
    );
  });

  it("reads alert-firing posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.alert-firing-posture.v1",
            generatedAt: "2026-07-02T02:00:00.000Z",
            orgId: "org_default",
            status: "ready",
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.live-alert-firing.v1",
              generatedAt: "2026-07-02T01:59:00.000Z",
              evidenceStatus: "passed",
              mode: "live",
              redactionPassed: true,
              failureCodes: [],
            },
            checks: {
              total: 7,
              requiredTotal: 5,
              requiredPresent: 5,
              missingRequired: [],
            },
            requiredAlerts: {
              total: 4,
              providerCategoryCount: 1,
              queueCategoryCount: 2,
              backupCategoryCount: 1,
              customCategoryCount: 0,
              requiredCategoriesMissing: [],
            },
            prometheus: {
              checked: true,
              status: "passed",
              originConfigured: true,
              firingAlertCount: 7,
              requiredFiringCount: 4,
            },
            alertmanager: {
              checked: true,
              status: "passed",
              originConfigured: true,
              activeAlertCount: 5,
              requiredActiveCount: 4,
            },
            redaction: {
              bearerTokensReturned: false,
              evidenceFileBodyReturned: false,
              rawAlertPayloadsReturned: false,
              rawAlertmanagerResponseReturned: false,
              rawAlertmanagerUrlReturned: false,
              rawEvidencePathReturned: false,
              rawPrometheusResponseReturned: false,
              rawPrometheusUrlReturned: false,
              secretValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const posture = await client.admin.alertFiringPosture();

    expect(posture.status).toBe("ready");
    expect(posture.evidence.status).toBe("satisfied");
    expect(posture.requiredAlerts.queueCategoryCount).toBe(2);
    expect(posture.prometheus.requiredFiringCount).toBe(4);
    expect(posture.redaction.rawPrometheusUrlReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/alert-firing/posture",
    );
  });

  it("reads sanitized SSO settings through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        const url = new URL(String(input));
        if (url.pathname.endsWith("/api/v1/billing/entitlements")) {
          return jsonResponse({
            data: {
              orgId: "org_default",
              generatedAt: "2026-07-02T00:00:00.000Z",
              status: "healthy",
              billingPlanConfigured: true,
              quotaTemplateCount: 1,
              unmanagedOrgQuotaCount: 0,
              warnings: [],
              billingPlan: {
                code: "team",
                name: "Team",
                source: "manual",
                status: "active",
                externalCustomerConfigured: false,
                externalSubscriptionConfigured: false,
                updatedAt: "2026-07-02T00:00:00.000Z",
              },
              quotas: [
                {
                  metric: "run.started",
                  expectedLimit: 1000,
                  expectedResetInterval: "monthly",
                  status: "matched",
                  actualLimit: 1000,
                  actualResetInterval: "monthly",
                  actualUsed: 0,
                  quotaBucketId: "quota_1",
                },
              ],
            },
          });
        }
        if (url.pathname.endsWith("/api/v1/billing/entitlements/reconcile")) {
          return jsonResponse({
            data: {
              before: {
                orgId: "org_default",
                generatedAt: "2026-07-02T00:00:00.000Z",
                status: "attention_required",
                billingPlanConfigured: true,
                quotaTemplateCount: 1,
                unmanagedOrgQuotaCount: 0,
                warnings: ["quota_missing"],
                quotas: [],
              },
              after: {
                orgId: "org_default",
                generatedAt: "2026-07-02T00:00:01.000Z",
                status: "healthy",
                billingPlanConfigured: true,
                quotaTemplateCount: 1,
                unmanagedOrgQuotaCount: 0,
                warnings: [],
                quotas: [],
              },
              actions: {
                createdQuotaIds: ["quota_1"],
                updatedQuotaIds: [],
                unchangedQuotaIds: [],
              },
            },
          });
        }
        return jsonResponse({
          data:
            calls.length === 1
              ? {
                  status: "enabled",
                  configurationSource: "environment",
                  generatedAt: "",
                  localLogin: { seededDevelopmentLoginEnabled: false },
                  oidc: {
                    detectedProviderPreset: "keycloak",
                    providerPresets: [
                      {
                        id: "keycloak",
                        name: "Keycloak",
                        recommendedGroupClaim: "groups",
                        issuerHint:
                          "https://keycloak.example.com/realms/{realm}",
                        notes: [],
                      },
                    ],
                    bearerTokenAuthEnabled: true,
                    browserPkceLoginEnabled: true,
                    issuerConfigured: true,
                    issuerHost: "idp.example.com",
                    clientIdConfigured: true,
                    groupClaim: "groups",
                    adminGroupCount: 1,
                    groupMappingCount: 0,
                    workspaceGroupMappingCount: 0,
                    workspaceGroupPrefixConfigured: false,
                    jitProvisioningEnabled: true,
                    accountLinkingEnabled: false,
                  },
                  notes: [],
                }
              : calls.length === 2
                ? {
                    status: "enabled",
                    configurationSource: "database",
                    generatedAt: "",
                    localLogin: { seededDevelopmentLoginEnabled: false },
                    oidc: {
                      detectedProviderPreset: "keycloak",
                      providerPresets: [
                        {
                          id: "keycloak",
                          name: "Keycloak",
                          recommendedGroupClaim: "groups",
                          issuerHint:
                            "https://keycloak.example.com/realms/{realm}",
                          notes: [],
                        },
                      ],
                      bearerTokenAuthEnabled: true,
                      browserPkceLoginEnabled: true,
                      issuerConfigured: true,
                      issuerHost: "idp.example.com",
                      clientIdConfigured: true,
                      groupClaim: "groups",
                      adminGroupCount: 1,
                      groupMappingCount: 1,
                      workspaceGroupMappingCount: 0,
                      workspaceGroupPrefixConfigured: false,
                      jitProvisioningEnabled: true,
                      accountLinkingEnabled: false,
                    },
                    notes: [],
                  }
                : calls.length === 3
                  ? {
                      status: "passed",
                      generatedAt: "",
                      checks: [
                        {
                          id: "jwks",
                          status: "pass",
                          code: "oidc_jwks_reachable",
                        },
                      ],
                      notes: [],
                    }
                  : {
                      status: "disabled",
                      issuerHost: "idp.example.com",
                      user: {
                        id: "user_oidc_1",
                        orgId: "org_default",
                        email: "oidc-user-1@example.com",
                        name: "OIDC User One",
                        disabledAt: "2026-06-27T00:00:00.000Z",
                      },
                    },
        });
      },
    });

    const report = await client.admin.ssoSettings();
    const updated = await client.admin.updateSsoSettings({
      oidc: {
        enabled: true,
        issuerUrl: "https://idp.example.com/realms/romeo",
        clientId: "romeo-web",
        providerPreset: "keycloak",
        groupMap: { reviewers: "group_reviewers" },
      },
    });
    const test = await client.admin.testSsoSettings();
    const deprovision = await client.admin.deprovisionOidcUser({
      issuerUrl: "https://idp.example.com/realms/romeo",
      oidcSubject: "oidc-user-1",
      confirmOidcSubject: "oidc-user-1",
    });

    expect(report.status).toBe("enabled");
    expect(updated.configurationSource).toBe("database");
    expect(report.oidc.issuerHost).toBe("idp.example.com");
    expect(test.status).toBe("passed");
    expect(deprovision.user.id).toBe("user_oidc_1");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/sso-settings",
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/admin/sso-settings",
    );
    expect(calls[1]?.init?.method).toBe("PATCH");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        oidc: {
          enabled: true,
          issuerUrl: "https://idp.example.com/realms/romeo",
          clientId: "romeo-web",
          providerPreset: "keycloak",
          groupMap: { reviewers: "group_reviewers" },
        },
      }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/admin/sso-settings/test",
    );
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/admin/sso/oidc/deprovision",
    );
    expect(calls[3]?.init?.method).toBe("POST");
    expect(calls[3]?.init?.body).toBe(
      JSON.stringify({
        issuerUrl: "https://idp.example.com/realms/romeo",
        oidcSubject: "oidc-user-1",
        confirmOidcSubject: "oidc-user-1",
      }),
    );
  });

  it("reads the enterprise auth provider catalog through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: [
            {
              id: "keycloak",
              name: "Keycloak",
              protocol: "oidc",
              configurationScopes: ["global", "org"],
              runtimePackage: "openid-client",
              status: "implemented",
              supportsJitProvisioning: true,
              supportsLocalFallback: true,
              supportsMfaDelegation: true,
              notes: [],
            },
            {
              id: "ldap",
              name: "LDAP",
              protocol: "ldap",
              configurationScopes: ["global", "org"],
              runtimePackage: "ldapts",
              status: "planned",
              supportsJitProvisioning: false,
              supportsLocalFallback: true,
              supportsMfaDelegation: false,
              notes: [],
            },
          ],
        });
      },
    });

    const catalog = await client.authProviderCatalog();

    expect(catalog[0]?.id).toBe("keycloak");
    expect(catalog[0]?.runtimePackage).toBe("openid-client");
    expect(catalog[1]?.status).toBe("planned");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/auth-providers/catalog",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads and updates enterprise auth provider settings through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            generatedAt: "2026-07-01T00:00:00.000Z",
            global: {
              providers: [
                {
                  providerId: "local",
                  enabled: true,
                  displayName: "Local Email and Password",
                  loginOrder: 0,
                  allowedEmailDomains: [],
                  orgOverridesAllowed: true,
                  secretRefConfigured: false,
                  source: calls.length === 1 ? "default" : "global",
                },
                {
                  providerId: "keycloak",
                  enabled: calls.length > 1,
                  displayName: "Keycloak",
                  loginOrder: 10,
                  allowedEmailDomains: ["example.com"],
                  orgOverridesAllowed: true,
                  oidc:
                    calls.length > 1
                      ? {
                          issuerConfigured: true,
                          issuerHost: "idp.example.com",
                          clientIdConfigured: true,
                          groupClaim: "groups",
                          adminGroupCount: 1,
                          groupMappingCount: 1,
                          workspaceGroupMappingCount: 0,
                          workspaceGroupPrefixConfigured: false,
                        }
                      : undefined,
                  secretRefConfigured: calls.length > 1,
                  secretRefScheme: calls.length > 1 ? "env" : undefined,
                  source: calls.length === 1 ? "default" : "global",
                },
              ],
            },
            orgOverride: {
              orgId: "org_default",
              providers:
                calls.length === 1
                  ? []
                  : [
                      {
                        providerId: "keycloak",
                        displayName: "Company SSO",
                        secretRefConfigured: false,
                        source: "org",
                      },
                    ],
            },
            effective: {
              orgId: "org_default",
              providers: [
                {
                  providerId: "keycloak",
                  catalogStatus: "implemented",
                  protocol: "oidc",
                  runtimePackage: "openid-client",
                  enabled: calls.length > 1,
                  displayName: calls.length === 1 ? "Keycloak" : "Company SSO",
                  loginOrder: 10,
                  allowedEmailDomains: ["example.com"],
                  orgOverridesAllowed: true,
                  oidc:
                    calls.length > 1
                      ? {
                          issuerConfigured: true,
                          issuerHost: "idp.example.com",
                          clientIdConfigured: true,
                          groupClaim: "groups",
                          adminGroupCount: 1,
                          groupMappingCount: 1,
                          workspaceGroupMappingCount: 0,
                          workspaceGroupPrefixConfigured: false,
                        }
                      : undefined,
                  secretRefConfigured: calls.length > 1,
                  secretRefScheme: calls.length > 1 ? "env" : undefined,
                  source: calls.length === 1 ? "default" : "org",
                },
              ],
            },
            notes: [],
          },
        });
      },
    });

    const report = await client.authProviderSettings();
    const updated = await client.updateAuthProviderSettings({
      global: {
        providers: [
          {
            providerId: "keycloak",
            enabled: true,
            allowedEmailDomains: ["example.com"],
            orgOverridesAllowed: true,
            oidc: {
              issuerUrl: "https://idp.example.com/realms/romeo",
              clientId: "romeo-web",
              groupClaim: "groups",
              adminGroups: ["admins"],
              groupMap: { engineers: "group_engineering" },
            },
            secretRef: "env://KEYCLOAK_CLIENT_SECRET",
          },
        ],
      },
      orgOverride: {
        providers: [
          {
            providerId: "keycloak",
            displayName: "Company SSO",
          },
        ],
      },
    });

    expect(report.global.providers[0]?.source).toBe("default");
    expect(updated.effective.providers[0]?.displayName).toBe("Company SSO");
    expect(updated.effective.providers[0]?.oidc?.issuerHost).toBe(
      "idp.example.com",
    );
    expect(updated.effective.providers[0]?.secretRefScheme).toBe("env");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/auth-providers/settings",
    );
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/admin/auth-providers/settings",
    );
    expect(calls[1]?.init?.method).toBe("PATCH");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        global: {
          providers: [
            {
              providerId: "keycloak",
              enabled: true,
              allowedEmailDomains: ["example.com"],
              orgOverridesAllowed: true,
              oidc: {
                issuerUrl: "https://idp.example.com/realms/romeo",
                clientId: "romeo-web",
                groupClaim: "groups",
                adminGroups: ["admins"],
                groupMap: { engineers: "group_engineering" },
              },
              secretRef: "env://KEYCLOAK_CLIENT_SECRET",
            },
          ],
        },
        orgOverride: {
          providers: [
            {
              providerId: "keycloak",
              displayName: "Company SSO",
            },
          ],
        },
      }),
    );
  });

  it("creates managed secret refs through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse(
          {
            data: {
              createdAt: "2026-07-01T00:00:00.000Z",
              nameConfigured: true,
              orgId: "org_default",
              purpose: "auth_provider_client_secret",
              scope: "org",
              secretRef: "romeo-secret://secret_okta",
              secretRefScheme: "romeo-secret",
              storageDriver: "local",
              valueStored: true,
            },
          },
          201,
        );
      },
    });

    const secret = await client.createManagedSecret({
      name: "Okta client secret",
      purpose: "auth_provider_client_secret",
      scope: "org",
      value: "secret-value",
    });

    expect(secret.secretRef).toBe("romeo-secret://secret_okta");
    expect(secret.secretRefScheme).toBe("romeo-secret");
    expect(secret.storageDriver).toBe("local");
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/admin/secrets");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        name: "Okta client secret",
        purpose: "auth_provider_client_secret",
        scope: "org",
        value: "secret-value",
      }),
    );
  });

  it("creates external Vault secret refs through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse(
          {
            data: {
              createdAt: "2026-07-01T00:00:00.000Z",
              nameConfigured: true,
              orgId: "org_default",
              purpose: "auth_provider_client_secret",
              scope: "org",
              secretRef: "vault://auth/okta/client-secret",
              secretRefScheme: "vault",
              storageDriver: "vault",
              valueStored: true,
            },
          },
          201,
        );
      },
    });

    const secret = await client.createManagedSecret({
      name: "Okta client secret",
      purpose: "auth_provider_client_secret",
      scope: "org",
      storageDriver: "vault",
      targetSecretRef: "vault://auth/okta/client-secret",
      value: "secret-value",
    });

    expect(secret.secretRef).toBe("vault://auth/okta/client-secret");
    expect(secret.secretRefScheme).toBe("vault");
    expect(secret.storageDriver).toBe("vault");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        name: "Okta client secret",
        purpose: "auth_provider_client_secret",
        scope: "org",
        storageDriver: "vault",
        targetSecretRef: "vault://auth/okta/client-secret",
        value: "secret-value",
      }),
    );
  });

  it("previews and executes secret envelope rewrap through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.secret-rotation-rewrap.v1",
            generatedAt: "2026-07-02T00:00:00.000Z",
            mode: calls.length === 1 ? "preview" : "apply",
            orgId: "org_default",
            status: calls.length === 1 ? "ready" : "completed",
            scope: {
              includeDisabledMfaFactors: calls.length > 1,
              includeGlobalManagedSecrets: calls.length > 1,
              targetOrgId: "org_default",
            },
            localMfa: {
              activeFactorCount: 1,
              currentKeyConfigured: true,
              decryptableCount: 1,
              disabledFactorCount: 0,
              eligibleCount: 1,
              failedCount: 0,
              failureCodes: [],
              pendingFactorCount: 0,
              previousKeyConfigured: true,
              previousKeyDecryptableCount: 1,
              rewrappedCount: calls.length === 1 ? 0 : 1,
              totpSecretsReturned: false,
            },
            managedSecrets: {
              currentKeyConfigured: true,
              decryptableCount: 1,
              eligibleCount: 1,
              failedCount: 0,
              failureCodes: [],
              globalSecretCount: calls.length > 1 ? 1 : 0,
              orgSecretCount: 1,
              previousKeyConfigured: true,
              previousKeyDecryptableCount: 1,
              rewrappedCount: calls.length === 1 ? 0 : 1,
              secretRefsReturned: false,
              secretValuesReturned: false,
            },
            warnings: [],
            redaction: {
              factorIdsReturned: false,
              keyMaterialReturned: false,
              rawSecretValuesReturned: false,
              secretRefsReturned: false,
              totpSecretsReturned: false,
              userEmailsReturned: false,
            },
          },
        });
      },
    });

    const preview = await client.admin.previewSecretRewrap({
      targetOrgId: "org_default",
    });
    const execute = await client.admin.executeSecretRewrap({
      confirmRewrap: "rewrap-secret-envelopes",
      includeDisabledMfaFactors: true,
      includeGlobalManagedSecrets: true,
      targetOrgId: "org_default",
    });

    expect(preview.mode).toBe("preview");
    expect(preview.localMfa.totpSecretsReturned).toBe(false);
    expect(execute.mode).toBe("apply");
    expect(execute.managedSecrets.secretValuesReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/secret-rotation/rewrap/preview",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ targetOrgId: "org_default" }),
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/admin/secret-rotation/rewrap",
    );
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        confirmRewrap: "rewrap-secret-envelopes",
        includeDisabledMfaFactors: true,
        includeGlobalManagedSecrets: true,
        targetOrgId: "org_default",
      }),
    );
  });

  it("tests enterprise auth provider connections through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            generatedAt: "2026-07-01T00:00:00.000Z",
            providerId:
              calls.length === 1
                ? "keycloak"
                : calls.length === 2
                  ? "local"
                  : calls.length === 3
                    ? "ldap"
                    : "saml",
            catalogStatus: "implemented",
            protocol:
              calls.length === 1
                ? "oidc"
                : calls.length === 2
                  ? "local"
                  : calls.length === 3
                    ? "ldap"
                    : "saml",
            runtimePackage:
              calls.length === 1
                ? "openid-client"
                : calls.length === 2
                  ? "@node-rs/argon2 + otplib"
                  : calls.length === 3
                    ? "ldapts"
                    : "@node-saml/node-saml",
            configurationSource:
              calls.length === 1 || calls.length === 3 || calls.length === 4
                ? "transient_request"
                : "provider_settings",
            status: "passed",
            enabled: calls.length !== 1,
            issuerHost: calls.length === 1 ? "keycloak.example.com" : undefined,
            detectedProviderPreset: calls.length === 1 ? "keycloak" : undefined,
            checks: [
              {
                id: "adapter",
                status: "pass",
                code: "auth_provider_adapter_available",
              },
            ],
            notes: [],
          },
        });
      },
    });

    const oidc = await client.testAuthProviderConnection({
      providerId: "keycloak",
      oidc: {
        issuerUrl: "https://keycloak.example.com/realms/romeo",
        clientId: "romeo-web",
      },
    });
    const local = await client.admin.testAuthProviderConnection({
      providerId: "local",
    });
    const ldap = await client.testAuthProviderConnection({
      providerId: "ldap",
      ldap: {
        url: "ldaps://ldap.example.com",
        baseDn: "dc=example,dc=com",
        bindDn: "cn=romeo,ou=svc,dc=example,dc=com",
        secretRef: "env://LDAP_BIND_PASSWORD",
      },
    });
    const saml = await client.testAuthProviderConnection({
      providerId: "saml",
      saml: {
        entryPoint: "https://idp.example.com/sso",
        idpCertificateRef: "env://SAML_IDP_CERT",
        spEntityId: "https://romeo.example.com/saml/metadata",
      },
    });

    expect(oidc.providerId).toBe("keycloak");
    expect(oidc.configurationSource).toBe("transient_request");
    expect(local.providerId).toBe("local");
    expect(ldap.providerId).toBe("ldap");
    expect(ldap.protocol).toBe("ldap");
    expect(saml.providerId).toBe("saml");
    expect(saml.protocol).toBe("saml");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/auth-providers/settings/test",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        providerId: "keycloak",
        oidc: {
          issuerUrl: "https://keycloak.example.com/realms/romeo",
          clientId: "romeo-web",
        },
      }),
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/admin/auth-providers/settings/test",
    );
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ providerId: "local" }));
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/admin/auth-providers/settings/test",
    );
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({
        providerId: "ldap",
        ldap: {
          url: "ldaps://ldap.example.com",
          baseDn: "dc=example,dc=com",
          bindDn: "cn=romeo,ou=svc,dc=example,dc=com",
          secretRef: "env://LDAP_BIND_PASSWORD",
        },
      }),
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/admin/auth-providers/settings/test",
    );
    expect(calls[3]?.init?.method).toBe("POST");
    expect(calls[3]?.init?.body).toBe(
      JSON.stringify({
        providerId: "saml",
        saml: {
          entryPoint: "https://idp.example.com/sso",
          idpCertificateRef: "env://SAML_IDP_CERT",
          spEntityId: "https://romeo.example.com/saml/metadata",
        },
      }),
    );
  });

  it("manages users through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        const url = new URL(String(input));
        if (url.pathname.endsWith("/api/v1/billing/lifecycle/enforce")) {
          return jsonResponse({
            data: {
              before: {
                orgId: "org_default",
                generatedAt: "2026-07-02T00:00:00.000Z",
                status: "attention_required",
                billingPlanConfigured: true,
                warnings: ["trial_expired"],
                recommendedAction: "mark_past_due",
                lifecycle: {
                  trialEndsAt: "2020-01-01T00:00:00.000Z",
                },
              },
              after: {
                orgId: "org_default",
                generatedAt: "2026-07-02T00:00:00.000Z",
                status: "healthy",
                billingPlanConfigured: true,
                warnings: [],
                recommendedAction: "none",
                lifecycle: {
                  trialEndsAt: "2020-01-01T00:00:00.000Z",
                },
              },
              action: {
                type: "mark_past_due",
                statusChanged: true,
                previousStatus: "trialing",
                newStatus: "past_due",
              },
            },
          });
        }
        if (url.pathname.endsWith("/api/v1/billing/lifecycle")) {
          return jsonResponse({
            data: {
              orgId: "org_default",
              generatedAt: "2026-07-02T00:00:00.000Z",
              status: "healthy",
              billingPlanConfigured: true,
              warnings: [],
              recommendedAction: "none",
              lifecycle: {},
            },
          });
        }
        return jsonResponse({
          data:
            calls.length === 1
              ? []
              : {
                  id: "user_1",
                  email: "user@example.com",
                  name: "User",
                  role: "org_admin",
                  disabledAt: "2026-06-27T00:00:00.000Z",
                },
        });
      },
    });

    await client.admin.users();
    await client.admin.disableUser("user/1");
    await client.admin.updateUserRole("user/1", {
      role: "org_admin",
      confirmUserId: "user/1",
    });
    await client.admin.setUserLocalPassword("user/1", {
      newPassword: "correct horse battery staple",
      confirmUserId: "user/1",
    });

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/users");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/users/user%2F1/disable",
    );
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/users/user%2F1/role",
    );
    expect(calls[2]?.init?.method).toBe("PATCH");
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({ role: "org_admin", confirmUserId: "user/1" }),
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/users/user%2F1/local-password",
    );
    expect(calls[3]?.init?.method).toBe("POST");
    expect(calls[3]?.init?.body).toBe(
      JSON.stringify({
        newPassword: "correct horse battery staple",
        confirmUserId: "user/1",
      }),
    );
  });

  it("previews directory sync through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.directory-sync.v1",
            orgId: "org_1",
            source: "scim",
            mode: "preview",
            status: "preview",
            generatedAt: "2026-07-02T00:00:00.000Z",
            requested: {
              disableMissingUsers: true,
              preserveAdminUsers: true,
              removeMissingGroupMembers: true,
            },
            limits: { maxUserDisables: 2, maxMembershipRemovals: 2 },
            changes: {
              userDisables: {
                count: 1,
                userIds: ["user_2"],
                skippedAdminUserIds: [],
                skippedSelfUserIds: [],
              },
              membershipRemovals: {
                count: 1,
                groups: [{ groupId: "group_1", userIds: ["user_2"], count: 1 }],
                skippedSelfUserIds: [],
              },
            },
            redaction: {
              externalGroupNamesReturned: false,
              externalSubjectIdsReturned: false,
              rawDirectoryPayloadReturned: false,
              userEmailsReturned: false,
              userNamesReturned: false,
            },
            warnings: ["users_will_be_disabled"],
          },
        });
      },
    });

    await expect(
      client.admin.directorySync({
        source: "scim",
        disableMissingUsers: true,
        removeMissingGroupMembers: true,
        presentUserIds: ["user_1"],
        groupMemberships: [{ groupId: "group_1", presentUserIds: ["user_1"] }],
      }),
    ).resolves.toMatchObject({ schema: "romeo.directory-sync.v1" });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/directory-sync",
    );
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        source: "scim",
        disableMissingUsers: true,
        removeMissingGroupMembers: true,
        presentUserIds: ["user_1"],
        groupMemberships: [{ groupId: "group_1", presentUserIds: ["user_1"] }],
      }),
    );
  });

  it("manages API keys and service accounts through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { results: [] } });
      },
    });

    await client.admin.apiKeys();
    await client.admin.createApiKey({ name: "Ops", scopes: ["admin:read"] });
    await client.admin.bulkRevokeApiKeys({ apiKeyIds: ["api/key/1"] });
    await client.admin.revokeApiKey("api/key/2");
    await client.admin.serviceAccounts();
    await client.admin.createServiceAccount({
      name: "Worker",
      scopes: ["admin:read"],
    });
    await client.admin.bulkDisableServiceAccounts({
      serviceAccountIds: ["service/account/1"],
    });
    await client.admin.createServiceAccountApiKey({
      serviceAccountId: "service/account/2",
      name: "Worker key",
      scopes: ["admin:read"],
    });
    await client.admin.disableServiceAccount("service/account/3");

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/api-keys");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/api-keys");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({ name: "Ops", scopes: ["admin:read"] }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/api-keys/bulk-revoke",
    );
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({ apiKeyIds: ["api/key/1"] }),
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/api-keys/api%2Fkey%2F2/revoke",
    );
    expect(calls[4]?.url).toBe("https://romeo.example/api/v1/service-accounts");
    expect(calls[4]?.init?.method).toBe("GET");
    expect(calls[5]?.url).toBe("https://romeo.example/api/v1/service-accounts");
    expect(calls[5]?.init?.body).toBe(
      JSON.stringify({ name: "Worker", scopes: ["admin:read"] }),
    );
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/service-accounts/bulk-disable",
    );
    expect(calls[6]?.init?.body).toBe(
      JSON.stringify({ serviceAccountIds: ["service/account/1"] }),
    );
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/service-accounts/service%2Faccount%2F2/api-keys",
    );
    expect(calls[7]?.init?.body).toBe(
      JSON.stringify({ name: "Worker key", scopes: ["admin:read"] }),
    );
    expect(calls[8]?.url).toBe(
      "https://romeo.example/api/v1/service-accounts/service%2Faccount%2F3/disable",
    );
  });

  it("manages billing plan hooks through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data:
            calls.length === 1
              ? null
              : { plan: { id: "billing_plan_1", code: "team" }, quotas: [] },
        });
      },
    });

    await client.admin.billingPlan();
    await client.admin.applyBillingPlan({
      code: "team",
      name: "Team",
      quotaTemplates: [
        { metric: "run.started", limit: 1000, resetInterval: "monthly" },
      ],
    });
    await client.admin.syncExternalBillingEvent({
      provider: "stripe",
      eventType: "invoice.paid",
      externalCustomerId: "cus_123",
      externalSubscriptionId: "sub_123",
      externalInvoiceId: "in_123",
      planCode: "team",
      planName: "Team",
      lifecycle: {
        currentPeriodEndsAt: "2099-01-01T00:00:00.000Z",
      },
      quotaTemplates: [
        { metric: "run.started", limit: 1000, resetInterval: "monthly" },
      ],
    });
    await client.admin.billingEntitlements();
    await client.admin.reconcileBillingEntitlements();
    await client.admin.billingLifecycle();
    await client.admin.enforceBillingLifecycle();
    await client.admin.billingOperationsPosture();
    await client.admin.auditIntegrityPosture();

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/billing/plan");
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/billing/plan");
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        code: "team",
        name: "Team",
        quotaTemplates: [
          { metric: "run.started", limit: 1000, resetInterval: "monthly" },
        ],
      }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/billing/external-events",
    );
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[2]?.init?.body).toContain('"eventType":"invoice.paid"');
    expect(calls[2]?.init?.body).toContain('"currentPeriodEndsAt"');
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/billing/entitlements",
    );
    expect(calls[3]?.init?.method).toBe("GET");
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/billing/entitlements/reconcile",
    );
    expect(calls[4]?.init?.method).toBe("POST");
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/billing/lifecycle",
    );
    expect(calls[5]?.init?.method).toBe("GET");
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/billing/lifecycle/enforce",
    );
    expect(calls[6]?.init?.method).toBe("POST");
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/admin/billing/operations-posture",
    );
    expect(calls[7]?.init?.method).toBe("GET");
    expect(calls[8]?.url).toBe(
      "https://romeo.example/api/v1/admin/audit-integrity/posture",
    );
    expect(calls[8]?.init?.method).toBe("GET");
  });

  it("manages abuse controls through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            orgId: "org_default",
            source: "org",
            generatedAt: "2026-07-02T00:00:00.000Z",
            suspension: { suspended: true, reasonCode: "abuse_review" },
            entitlements: {
              enforceBillingStatus: true,
              denyWhenBillingPlanMissing: true,
              allowedBillingStatuses: ["active", "trialing"],
            },
            killSwitches: {
              connectorIds: [],
              providerIds: ["provider_openai_compatible"],
              toolIds: ["tool_calculator"],
              workerClasses: ["external_tool_operations"],
            },
            enforcement: {
              billingPlanConfigured: true,
              billingStatus: "active",
              costWorkBlocked: true,
              defaultBlockReasons: ["org_suspended"],
              activeKillSwitchCount: 3,
            },
          },
        });
      },
    });

    await client.admin.abuseControls();
    await client.admin.updateAbuseControls({
      suspension: { suspended: true, reasonCode: "abuse_review" },
      entitlements: {
        enforceBillingStatus: true,
        denyWhenBillingPlanMissing: true,
        allowedBillingStatuses: ["active", "trialing"],
      },
      killSwitches: {
        providerIds: ["provider_openai_compatible"],
        toolIds: ["tool_calculator"],
        workerClasses: ["external_tool_operations"],
      },
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/abuse-controls",
    );
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/admin/abuse-controls",
    );
    expect(calls[1]?.init?.method).toBe("PATCH");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        suspension: { suspended: true, reasonCode: "abuse_review" },
        entitlements: {
          enforceBillingStatus: true,
          denyWhenBillingPlanMissing: true,
          allowedBillingStatuses: ["active", "trialing"],
        },
        killSwitches: {
          providerIds: ["provider_openai_compatible"],
          toolIds: ["tool_calculator"],
          workerClasses: ["external_tool_operations"],
        },
      }),
    );
  });

  it("manages tenant organizations through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            organization: {
              id: "org/acme",
              name: "Acme Inc",
              slug: "acme-inc",
            },
            counts: {
              activeApiKeys: 1,
              disabledUsers: 0,
              serviceAccounts: 0,
              users: 1,
              workspaces: 1,
            },
            suspension: { suspended: false },
          },
        });
      },
    });

    await client.admin.tenantOrganizations();
    await client.admin.createTenantOrganization({
      name: "Acme Inc",
      slug: "acme-inc",
      defaultWorkspace: { name: "Operations", slug: "ops" },
      initialAdmin: {
        email: "ops-admin@acme.example",
        name: "Acme Ops Admin",
        password: "correct horse battery staple",
      },
    });
    await client.admin.tenantOrganization("org/acme");
    await client.admin.updateTenantOrganization("org/acme", {
      name: "Acme",
    });
    await client.admin.suspendTenantOrganization("org/acme", {
      confirmOrgId: "org/acme",
      reasonCode: "abuse_review",
    });
    await client.admin.reactivateTenantOrganization("org/acme", {
      confirmOrgId: "org/acme",
    });
    await client.admin.requestTenantDeletion("org/acme", {
      confirmOrgId: "org/acme",
      reasonCode: "customer_request",
    });
    await client.admin.cancelTenantDeletionRequest("org/acme", {
      confirmOrgId: "org/acme",
    });
    await client.admin.tenantDeletionFinalizationPreview("org/acme");
    await client.admin.recordTenantDeletionFinalizationEvidence("org/acme", {
      confirmOrgId: "org/acme",
      controls: [
        {
          control: "backup_retention_review",
          evidenceRefHash:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          status: "passed",
        },
      ],
    });
    await client.admin.executeTenantDeletionFinalization("org/acme", {
      confirmOrgId: "org/acme",
      confirmPermanentDeletion: true,
    });

    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ["GET", "https://romeo.example/api/v1/admin/organizations"],
      ["POST", "https://romeo.example/api/v1/admin/organizations"],
      ["GET", "https://romeo.example/api/v1/admin/organizations/org%2Facme"],
      ["PATCH", "https://romeo.example/api/v1/admin/organizations/org%2Facme"],
      [
        "POST",
        "https://romeo.example/api/v1/admin/organizations/org%2Facme/suspend",
      ],
      [
        "POST",
        "https://romeo.example/api/v1/admin/organizations/org%2Facme/reactivate",
      ],
      [
        "POST",
        "https://romeo.example/api/v1/admin/organizations/org%2Facme/deletion-request",
      ],
      [
        "POST",
        "https://romeo.example/api/v1/admin/organizations/org%2Facme/deletion-request/cancel",
      ],
      [
        "GET",
        "https://romeo.example/api/v1/admin/organizations/org%2Facme/deletion-finalization-preview",
      ],
      [
        "POST",
        "https://romeo.example/api/v1/admin/organizations/org%2Facme/deletion-finalization-evidence",
      ],
      [
        "POST",
        "https://romeo.example/api/v1/admin/organizations/org%2Facme/deletion-finalization/execute",
      ],
    ]);
    expect(calls[1]?.init?.body).toContain("correct horse battery staple");
    expect(calls[3]?.init?.body).toBe(JSON.stringify({ name: "Acme" }));
    expect(calls[4]?.init?.body).toBe(
      JSON.stringify({
        confirmOrgId: "org/acme",
        reasonCode: "abuse_review",
      }),
    );
    expect(calls[9]?.init?.body).toContain("backup_retention_review");
    expect(calls[10]?.init?.body).toBe(
      JSON.stringify({
        confirmOrgId: "org/acme",
        confirmPermanentDeletion: true,
      }),
    );
  });

  it("reads tenant purge evidence posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.tenant-purge-evidence-posture.v1",
            generatedAt: "2026-07-06T20:30:00.000Z",
            orgId: "org_default",
            status: "ready",
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.tenant-purge-evidence.v1",
              generatedAt: "2026-07-06T20:29:00.000Z",
              evidenceStatus: "passed",
              mode: "live",
              deployment: "kubernetes",
              failureCodes: [],
            },
            checks: {
              total: 8,
              requiredTotal: 8,
              requiredPresent: 8,
              missingRequired: [],
            },
            purge: {
              tenantCount: 1,
              databasePurgedTenantCount: 1,
              objectStorePurgedTenantCount: 1,
              externalVectorReviewedTenantCount: 1,
              backupRetentionReviewedTenantCount: 1,
              operationalLogRetentionReviewedTenantCount: 1,
              supportBundleReviewedTenantCount: 1,
              externalSecretReviewedTenantCount: 1,
            },
            storage: {
              postgresRecordCount: 42,
              objectStoreObjectCount: 7,
              externalVectorNamespaceCount: 2,
              backupSystemCount: 2,
              operationalLogSystemCount: 3,
              supportBundleSystemCount: 1,
              secretStoreCount: 2,
            },
            retention: {
              backupRetentionDays: 90,
              operationalLogRetentionDays: 30,
              supportBundleRetentionDays: 14,
            },
            redaction: {
              backupLocationsReturned: false,
              evidenceFileBodiesReturned: false,
              objectStoreKeysReturned: false,
              operationalLogBodiesReturned: false,
              rawEvidencePathsReturned: false,
              secretValuesReturned: false,
              supportBundleBodiesReturned: false,
              vectorValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const posture = await client.admin.tenantPurgeEvidencePosture();

    expect(posture.schema).toBe("romeo.tenant-purge-evidence-posture.v1");
    expect(posture.status).toBe("ready");
    expect(posture.purge.databasePurgedTenantCount).toBe(1);
    expect(posture.redaction.secretValuesReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/tenant-deletion/purge-evidence-posture",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("manages quota controls through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        const url = new URL(String(input));
        if (url.pathname.endsWith("/api/v1/quotas/distributed-status")) {
          return jsonResponse({
            data: {
              driver: "valkey",
              enabled: true,
              configured: true,
              healthy: true,
              keyPrefix: "romeo:quota:v1",
              checkedAt: "2026-07-02T00:00:00.000Z",
              details: {
                failClosed: true,
                statusCode: "healthy",
              },
            },
          });
        }
        return jsonResponse({
          data: {
            id: "quota_1",
            orgId: "org_default",
            scopeType: "org",
            scopeId: "org_default",
            metric: "tool.call",
            limit: 10,
            used: 0,
            resetInterval: "monthly",
            createdAt: "2026-07-02T00:00:00.000Z",
            updatedAt: "2026-07-02T00:00:00.000Z",
          },
        });
      },
    });

    await client.admin.quotas();
    await client.admin.quotaCoordinationStatus();
    await client.admin.createQuota({
      scopeType: "org",
      metric: "tool.call",
      limit: 10,
      resetInterval: "monthly",
    });
    await client.admin.updateQuota("quota/1", {
      limit: 20,
      resetUsage: true,
    });
    await client.admin.deleteQuota("quota/1");

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/quotas");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/quotas/distributed-status",
    );
    expect(calls[1]?.init?.method).toBe("GET");
    expect(calls[2]?.url).toBe("https://romeo.example/api/v1/quotas");
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({
        scopeType: "org",
        metric: "tool.call",
        limit: 10,
        resetInterval: "monthly",
      }),
    );
    expect(calls[3]?.url).toBe("https://romeo.example/api/v1/quotas/quota%2F1");
    expect(calls[3]?.init?.method).toBe("PATCH");
    expect(calls[3]?.init?.body).toBe(
      JSON.stringify({ limit: 20, resetUsage: true }),
    );
    expect(calls[4]?.url).toBe("https://romeo.example/api/v1/quotas/quota%2F1");
    expect(calls[4]?.init?.method).toBe("DELETE");
  });

  it("manages device authorizations through the device resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            authorization: {
              id: "device_auth_1",
              name: "MacBook",
              scopes: ["me:read"],
              accessApiKeyId: "api_key_1",
            },
            accessToken: "rmk_test",
            refreshToken: "rmr_test",
          },
        });
      },
    });

    await client.deviceAuthorizations.create({
      name: "MacBook",
      scopes: ["me:read"],
      ttlDays: 30,
    });
    await client.deviceAuthorizations.refresh("rmr_test");
    await client.deviceAuthorizations.revoke("device/auth/1");

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/device-authorizations",
    );
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ name: "MacBook", scopes: ["me:read"], ttlDays: 30 }),
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/device-authorizations/refresh",
    );
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({ refreshToken: "rmr_test" }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/device-authorizations/device%2Fauth%2F1/revoke",
    );
  });

  it("manages local sessions through the session resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            session: { id: "session_1", name: "Browser", scopes: ["me:read"] },
            token: "rms_test",
          },
        });
      },
    });

    await client.sessions.list();
    await client.sessions.supportSessionReports();
    await client.sessions.create({ name: "Browser", ttlHours: 12 });
    await client.sessions.createSupportSession({
      targetUserId: "user_target",
      confirmTargetUserId: "user_target",
      reason: "Support ticket investigation",
      ticketRef: "TICKET-123",
      ttlMinutes: 15,
    });
    await client.sessions.supportSessionRequests();
    await client.sessions.requestSupportSession({
      targetUserId: "user_target",
      confirmTargetUserId: "user_target",
      reason: "Support ticket investigation",
      ticketRef: "TICKET-123",
      ttlMinutes: 15,
    });
    await client.sessions.approveSupportSessionRequest("support_request_1");
    await client.sessions.rejectSupportSessionRequest("support_request_2");
    await client.sessions.revokeSupportSession("session_support_1");
    await client.sessions.revokeCurrent();
    await client.sessions.revokeOthers();
    await client.sessions.revoke("session/2");

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/sessions");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/admin/impersonation/sessions",
    );
    expect(calls[1]?.init?.method).toBe("GET");
    expect(calls[2]?.url).toBe("https://romeo.example/api/v1/sessions");
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({ name: "Browser", ttlHours: 12 }),
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/admin/impersonation/sessions",
    );
    expect(calls[3]?.init?.body).toBe(
      JSON.stringify({
        targetUserId: "user_target",
        confirmTargetUserId: "user_target",
        reason: "Support ticket investigation",
        ticketRef: "TICKET-123",
        ttlMinutes: 15,
      }),
    );
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/admin/impersonation/requests",
    );
    expect(calls[4]?.init?.method).toBe("GET");
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/admin/impersonation/requests",
    );
    expect(calls[5]?.init?.body).toBe(
      JSON.stringify({
        targetUserId: "user_target",
        confirmTargetUserId: "user_target",
        reason: "Support ticket investigation",
        ticketRef: "TICKET-123",
        ttlMinutes: 15,
      }),
    );
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/admin/impersonation/requests/support_request_1/approve",
    );
    expect(calls[6]?.init?.method).toBe("POST");
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/admin/impersonation/requests/support_request_2/reject",
    );
    expect(calls[7]?.init?.method).toBe("POST");
    expect(calls[8]?.url).toBe(
      "https://romeo.example/api/v1/admin/impersonation/sessions/session_support_1/revoke",
    );
    expect(calls[8]?.init?.method).toBe("POST");
    expect(calls[9]?.url).toBe("https://romeo.example/api/v1/sessions/current");
    expect(calls[9]?.init?.method).toBe("DELETE");
    expect(calls[10]?.url).toBe(
      "https://romeo.example/api/v1/sessions/revoke-others",
    );
    expect(calls[10]?.init?.method).toBe("POST");
    expect(calls[11]?.url).toBe(
      "https://romeo.example/api/v1/sessions/session%2F2",
    );
    expect(calls[11]?.init?.method).toBe("DELETE");
  });

  it("starts browser OIDC login through the session resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            authorizationUrl: "https://idp.example.com/auth",
            expiresAt: "2026-06-27T12:00:00.000Z",
            orgId: "org_enterprise",
            providerId: "okta",
          },
        });
      },
    });

    const result = await client.startOidcLogin({
      orgId: "org_enterprise",
      providerId: "okta",
      returnTo: "/app?tab=home",
    });

    expect(result.authorizationUrl).toBe("https://idp.example.com/auth");
    expect(result.orgId).toBe("org_enterprise");
    expect(result.providerId).toBe("okta");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/auth/oidc/start?returnTo=%2Fapp%3Ftab%3Dhome&orgId=org_enterprise&providerId=okta",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("starts GitHub OAuth2 login through the session resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            authorizationUrl: "https://github.com/login/oauth/authorize",
            expiresAt: "2026-06-27T12:00:00.000Z",
            providerId: "github",
          },
        });
      },
    });

    const result = await client.startOAuth2Login({
      orgId: "org_default",
      providerId: "github",
      returnTo: "/app?tab=home",
    });

    expect(result.providerId).toBe("github");
    expect(result.authorizationUrl).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/auth/oauth2/start?providerId=github&returnTo=%2Fapp%3Ftab%3Dhome&orgId=org_default",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("starts SAML login through the session resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            authorizationUrl: "https://idp.example.com/sso",
            expiresAt: "2026-06-27T12:00:00.000Z",
            providerId: "saml",
          },
        });
      },
    });

    const result = await client.startSamlLogin({
      orgId: "org_default",
      providerId: "saml",
      returnTo: "/app?tab=home",
    });

    expect(result.providerId).toBe("saml");
    expect(result.authorizationUrl).toBe("https://idp.example.com/sso");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/auth/saml/start?providerId=saml&returnTo=%2Fapp%3Ftab%3Dhome&orgId=org_default",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("authenticates LDAP login through the session resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            status: "authenticated",
            session: {
              id: "session_ldap_1",
              name: "LDAP login",
              scopes: ["me:read"],
            },
            token: "rms_ldap_session",
          },
        });
      },
    });

    const result = await client.ldapLogin({
      identifier: "ldap.user@example.com",
      orgId: "org_default",
      password: "directory password",
      providerId: "ldap",
    });

    expect(result.status).toBe("authenticated");
    expect(result.token).toBe("rms_ldap_session");
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/auth/ldap/login");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        identifier: "ldap.user@example.com",
        orgId: "org_default",
        password: "directory password",
        providerId: "ldap",
      }),
    );
  });

  it("manages local password login and TOTP MFA through the session resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data:
            calls.length === 1
              ? { status: "mfa_required", challengeToken: "lmc_test" }
              : calls.length === 5
                ? {
                    factorId: "mfa_factor_1",
                    secret: "BASE32SECRET",
                    otpauthUrl: "otpauth://totp/Romeo:user",
                  }
                : {
                    status: "authenticated",
                    session: {
                      id: "session_1",
                      name: "Local browser",
                      scopes: ["me:read"],
                    },
                  },
        });
      },
    });

    await client.localLogin({
      email: "admin@romeo.local",
      password: "correct horse battery staple",
      orgId: "org_default",
    });
    await client.verifyLocalMfa({
      challengeToken: "lmc_test",
      code: "123456",
    });
    await client.localAuthStatus();
    await client.setLocalPassword({
      currentPassword: "old local password",
      newPassword: "correct horse battery staple",
    });
    await client.startTotpEnrollment({ name: "Authenticator app" });
    await client.confirmTotpEnrollment({
      factorId: "mfa_factor_1",
      code: "123456",
    });
    await client.generateRecoveryCodes({ totpCode: "123456" });
    await client.disableMfaFactor("mfa/factor/1", { code: "123456" });

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/auth/local/login");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        email: "admin@romeo.local",
        password: "correct horse battery staple",
        orgId: "org_default",
      }),
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/auth/local/mfa/verify",
    );
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({ challengeToken: "lmc_test", code: "123456" }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/auth/local/status",
    );
    expect(calls[2]?.init?.method).toBe("GET");
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/auth/local/password",
    );
    expect(calls[3]?.init?.body).toBe(
      JSON.stringify({
        currentPassword: "old local password",
        newPassword: "correct horse battery staple",
      }),
    );
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/auth/local/mfa/totp/enroll",
    );
    expect(calls[4]?.init?.body).toBe(
      JSON.stringify({ name: "Authenticator app" }),
    );
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/auth/local/mfa/totp/confirm",
    );
    expect(calls[5]?.init?.body).toBe(
      JSON.stringify({ factorId: "mfa_factor_1", code: "123456" }),
    );
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/auth/local/mfa/recovery-codes/generate",
    );
    expect(calls[6]?.init?.body).toBe(JSON.stringify({ totpCode: "123456" }));
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/auth/local/mfa/factors/mfa%2Ffactor%2F1/disable",
    );
    expect(calls[7]?.init?.body).toBe(JSON.stringify({ code: "123456" }));
  });

  it("manages groups through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data:
            calls.length === 1 || calls.length === 3
              ? []
              : { id: "group_reviewers", userId: "user_1" },
        });
      },
    });

    await client.admin.groups();
    await client.admin.createGroup({ name: "Reviewers", slug: "reviewers" });
    await client.admin.groupMembers("group/reviewers");
    await client.admin.addGroupMember("group/reviewers", { userId: "user/1" });
    await client.admin.removeGroupMember("group/reviewers", "user/1");

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/groups");
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/groups");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({ name: "Reviewers", slug: "reviewers" }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/groups/group%2Freviewers/members",
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/groups/group%2Freviewers/members",
    );
    expect(calls[3]?.init?.body).toBe(JSON.stringify({ userId: "user/1" }));
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/groups/group%2Freviewers/members/user%2F1",
    );
    expect(calls[4]?.init?.method).toBe("DELETE");
  });

  it("creates eval suites through the eval resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: { suite: { id: "eval_suite_1" }, cases: [] },
        });
      },
    });

    await client.evals.createSuite({
      agentId: "agent_1",
      name: "Golden prompts",
      cases: [
        {
          input: "Hello",
          expectedContains: "Romeo",
          rubric: {
            expectedToolCalls: [{ name: "search" }],
            expectedToolOutcomes: [
              {
                name: "search",
                status: "success",
                outputKeys: ["results"],
              },
            ],
            requiredCitations: ["chunk_access"],
          },
        },
      ],
    });

    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/eval-suites");
    expect(calls[0]?.init?.body).toContain("Golden prompts");
    expect(calls[0]?.init?.body).toContain("expectedToolCalls");
    expect(calls[0]?.init?.body).toContain("expectedToolOutcomes");
    expect(calls[0]?.init?.body).toContain("requiredCitations");
  });

  it("compares eval suites across models through the eval resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            suiteId: "eval/suite/1",
            comparedAt: "2026-01-01T00:00:00.000Z",
            comparisons: [],
          },
        });
      },
    });

    await client.evals.compareModels("eval/suite/1", {
      modelIds: ["model_1", "model_2"],
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/eval-suites/eval%2Fsuite%2F1/model-comparisons",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ modelIds: ["model_1", "model_2"] }),
    );
  });

  it("reads eval dashboards through the eval resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            agentId: "agent/1",
            generatedAt: "2026-01-01T00:00:00.000Z",
            status: "passed",
            suiteCount: 1,
            runCount: 1,
            averageLatestScore: 1,
            suites: [],
            trend: [],
          },
        });
      },
    });

    await client.evals.dashboard("agent/1");

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/agents/agent%2F1/eval-dashboard",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads release-candidate eval evidence through the eval resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.eval-release-candidate-evidence.v1",
            orgId: "org_1",
            workspaceId: "workspace_1",
            agentId: "agent/1",
            generatedAt: "2026-01-01T00:00:00.000Z",
            candidate: {
              baseModelId: "model_1",
              draftUpdatedAt: "2026-01-01T00:00:00.000Z",
            },
            gate: {
              status: "passed",
              publishBlocked: false,
              reasonCodes: [],
              suiteCount: 1,
              passedSuiteCount: 1,
              failedSuiteCount: 0,
              missingSuiteCount: 0,
              averageScore: 1,
              evaluatedAt: "2026-01-01T00:00:00.000Z",
            },
            suites: [
              {
                suiteId: "suite_1",
                name: "Golden prompts",
                latestRunId: "eval_run_1",
                status: "passed",
                score: 1,
                completedAt: "2026-01-01T00:00:00.000Z",
                caseCount: 1,
                resultCount: 1,
                passedResultCount: 1,
                failedResultCount: 0,
                requirementCounts: {
                  expectedContainsCases: 0,
                  citationRequiredCases: 0,
                  rubricCases: 1,
                  toolExpectationCases: 1,
                  expectedToolCallCases: 1,
                  expectedToolOutcomeCases: 1,
                },
                toolEvaluation: {
                  expectedToolCalls: {
                    total: 1,
                    passed: 1,
                    failed: 0,
                  },
                  expectedToolOutcomes: {
                    total: 1,
                    passed: 1,
                    failed: 0,
                  },
                  failedToolExpectationCaseCount: 0,
                },
                humanRatingCounts: {
                  pass: 0,
                  neutral: 0,
                  fail: 0,
                  total: 0,
                },
              },
            ],
            redaction: {
              rawEvalInputsReturned: false,
              rawEvalOutputsReturned: false,
              rawHumanRatingCommentsReturned: false,
              rawRubricTermsReturned: false,
              rawToolArgumentsReturned: false,
              rawToolNamesReturned: false,
              rawToolOutputKeysReturned: false,
              rawToolResultBodiesReturned: false,
            },
          },
        });
      },
    });

    const evidence = await client.evals.releaseCandidateEvidence("agent/1");

    expect(evidence.gate.status).toBe("passed");
    expect(evidence.suites[0]?.toolEvaluation.expectedToolCalls.passed).toBe(1);
    expect(evidence.redaction.rawToolArgumentsReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/agents/agent%2F1/eval-release-candidate-evidence",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("lists and writes eval human ratings through the eval resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: [] });
      },
    });

    await client.evals.ratings("eval/run/1");
    await client.evals.rateResult("eval/result/1", {
      rating: "pass",
      comment: "Approved",
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/eval-runs/eval%2Frun%2F1/ratings",
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/eval-run-results/eval%2Fresult%2F1/rating",
    );
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({ rating: "pass", comment: "Approved" }),
    );
  });

  it("shares agents through the collaboration resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: [] });
      },
    });

    await client.collaboration.shareAgent("agent/1", {
      principalType: "group",
      principalId: "group_reviewers",
      permissions: ["read", "run"],
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/agents/agent%2F1/shares",
    );
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        principalType: "group",
        principalId: "group_reviewers",
        permissions: ["read", "run"],
      }),
    );
  });

  it("searches share targets through the collaboration resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: [
            { principalType: "user", principalId: "user_1", label: "Alice" },
          ],
        });
      },
    });

    const targets = await client.collaboration.shareTargets(
      "alice reviewer",
      5,
    );

    expect(targets[0]?.principalId).toBe("user_1");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/share-targets?query=alice+reviewer&limit=5",
    );
  });

  it("manages prompt templates through the collaboration resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: calls.length < 3 ? [] : { id: "prompt_1", name: "Responder" },
        });
      },
    });

    await client.collaboration.promptTemplates("workspace/1", "incident");
    await client.collaboration.promptMarketplace("workspace/1");
    await client.collaboration.createPromptTemplate({
      workspaceId: "workspace/1",
      name: "Responder",
      body: "Summarize this incident.",
      tags: ["ops"],
      visibility: "marketplace",
    });
    await client.collaboration.updatePromptTemplate("prompt/1", {
      visibility: "workspace",
    });
    await client.collaboration.deletePromptTemplate("prompt/1");
    await client.collaboration.sharePromptTemplate("prompt/1", {
      principalType: "group",
      principalId: "group_reviewers",
      permissions: ["read", "use"],
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/prompt-templates?workspaceId=workspace%2F1&query=incident",
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/prompt-marketplace?workspaceId=workspace%2F1",
    );
    expect(calls[2]?.url).toBe("https://romeo.example/api/v1/prompt-templates");
    expect(calls[2]?.init?.body).toContain('"visibility":"marketplace"');
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/prompt-templates/prompt%2F1",
    );
    expect(calls[3]?.init?.method).toBe("PATCH");
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/prompt-templates/prompt%2F1",
    );
    expect(calls[4]?.init?.method).toBe("DELETE");
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/prompt-templates/prompt%2F1/shares",
    );
  });

  it("shares chats through the collaboration resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: [] });
      },
    });

    await client.collaboration.shareChat("chat/1", {
      principalType: "group",
      principalId: "group_reviewers",
      permissions: ["read", "write"],
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/shares",
    );
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        principalType: "group",
        principalId: "group_reviewers",
        permissions: ["read", "write"],
      }),
    );
  });

  it("shares files through the collaboration resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: [] });
      },
    });

    await client.collaboration.shareFile("file/1", {
      principalType: "service_account",
      principalId: "svc_reader",
      permissions: ["read"],
    });
    await client.collaboration.fileShares("file/1");

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/files/file%2F1/shares",
    );
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        principalType: "service_account",
        principalId: "svc_reader",
        permissions: ["read"],
      }),
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/files/file%2F1/shares",
    );
    expect(calls[1]?.init?.method).toBe("GET");
  });

  it("manages workspace folders through the collaboration resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: [] });
      },
    });

    await client.collaboration.folders("workspace/1");
    await client.collaboration.createFolder({
      workspaceId: "workspace/1",
      name: "Review pack",
      parentId: "folder/root",
      isExpanded: true,
      meta: { icon: "folder" },
    });
    await client.collaboration.folder("folder/1");
    await client.collaboration.updateFolder("folder/1", {
      name: "Review pack updated",
      parentId: null,
      data: { color: "blue" },
    });
    await client.collaboration.shareFolder("folder/1", {
      principalType: "group",
      principalId: "group_reviewers",
      permissions: ["read"],
    });
    await client.collaboration.addFolderItem("folder/1", {
      resourceType: "chat",
      resourceId: "chat/1",
    });
    await client.collaboration.deleteFolderItem("folder/1", "item/1");
    await client.collaboration.deleteFolder("folder/1");

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/folders?workspaceId=workspace%2F1",
    );
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/folders");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        workspaceId: "workspace/1",
        name: "Review pack",
        parentId: "folder/root",
        isExpanded: true,
        meta: { icon: "folder" },
      }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/folders/folder%2F1",
    );
    expect(calls[2]?.init?.method).toBe("GET");
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/folders/folder%2F1",
    );
    expect(calls[3]?.init?.method).toBe("PATCH");
    expect(calls[3]?.init?.body).toBe(
      JSON.stringify({
        name: "Review pack updated",
        parentId: null,
        data: { color: "blue" },
      }),
    );
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/folders/folder%2F1/shares",
    );
    expect(calls[4]?.init?.body).toBe(
      JSON.stringify({
        principalType: "group",
        principalId: "group_reviewers",
        permissions: ["read"],
      }),
    );
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/folders/folder%2F1/items",
    );
    expect(calls[5]?.init?.body).toBe(
      JSON.stringify({ resourceType: "chat", resourceId: "chat/1" }),
    );
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/folders/folder%2F1/items/item%2F1",
    );
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/folders/folder%2F1",
    );
    expect(calls[7]?.init?.method).toBe("DELETE");
  });

  it("creates and syncs data connectors through the connector resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: String(input).endsWith("/data-connectors/catalog")
            ? { executionDriver: "managed-fetch", connectors: [] }
            : { id: "connector_1", status: "active" },
        });
      },
    });

    await client.dataConnectors.catalog();
    await client.dataConnectors.create({
      workspaceId: "workspace_1",
      knowledgeBaseId: "kb_1",
      type: "website",
      name: "Docs",
      syncIntervalMinutes: 60,
      config: { url: "https://docs.example.com" },
    });
    await client.dataConnectors.sync({
      connectorId: "connector/1",
      items: [
        {
          fileName: "notes.md",
          mimeType: "text/markdown",
          content: "Romeo connector notes.",
        },
      ],
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/data-connectors/catalog",
    );
    expect(calls[1]?.url).toBe("https://romeo.example/api/v1/data-connectors");
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        workspaceId: "workspace_1",
        knowledgeBaseId: "kb_1",
        type: "website",
        name: "Docs",
        syncIntervalMinutes: 60,
        config: { url: "https://docs.example.com" },
      }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/data-connectors/connector%2F1/sync",
    );
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({
        items: [
          {
            fileName: "notes.md",
            mimeType: "text/markdown",
            content: "Romeo connector notes.",
          },
        ],
      }),
    );
  });

  it("starts delegated OAuth flows through the delegated OAuth resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        if (String(input).endsWith("/providers")) {
          return jsonResponse({
            data: [
              {
                id: "github",
                displayName: "GitHub",
                configured: true,
                connectorTypes: ["github"],
                defaultScopes: ["repo"],
                authorizationHost: "github.com",
                tokenHost: "github.com",
                pkceRequired: true,
              },
            ],
          });
        }
        if (String(input).includes("/connections?")) {
          return jsonResponse({
            data: [
              {
                id: "delegated_oauth_connection_1",
                workspaceId: "workspace_1",
                userId: "user_1",
                providerId: "github",
                connectorType: "github",
                providerAccountHash: "5994471abb01112a",
                providerAccountLoginConfigured: true,
                providerAccountLoginHash: "a6658157f0df8390",
                scopes: ["repo"],
                status: "active",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        if (
          String(input).endsWith(
            "/connections/delegated_oauth_connection_1/revoke",
          )
        ) {
          return jsonResponse({
            data: {
              id: "delegated_oauth_connection_1",
              workspaceId: "workspace_1",
              userId: "user_1",
              providerId: "github",
              connectorType: "github",
              providerAccountHash: "5994471abb01112a",
              providerAccountLoginConfigured: true,
              scopes: ["repo"],
              status: "revoked",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:01:00.000Z",
              revokedAt: "2026-01-01T00:01:00.000Z",
            },
          });
        }
        return jsonResponse({
          data: {
            authorizationUrl: "https://github.com/login/oauth/authorize",
            connectorType: "github",
            expiresAt: "2026-01-01T00:10:00.000Z",
            provider: { id: "github" },
            scopes: ["repo"],
            workspaceId: "workspace_1",
          },
        });
      },
    });

    await expect(client.delegatedOAuth.providers()).resolves.toHaveLength(1);
    await client.delegatedOAuth.start({
      providerId: "github",
      workspaceId: "workspace_1",
      connectorType: "github",
      scopes: ["repo"],
      returnTo: "/settings/connectors",
    });
    await expect(
      client.delegatedOAuth.connections("workspace_1"),
    ).resolves.toHaveLength(1);
    await expect(
      client.delegatedOAuth.revoke("delegated_oauth_connection_1"),
    ).resolves.toMatchObject({ status: "revoked" });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/delegated-oauth/providers",
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/delegated-oauth/start",
    );
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        providerId: "github",
        workspaceId: "workspace_1",
        connectorType: "github",
        scopes: ["repo"],
        returnTo: "/settings/connectors",
      }),
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/delegated-oauth/connections?workspaceId=workspace_1",
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/delegated-oauth/connections/delegated_oauth_connection_1/revoke",
    );
  });

  it("reads delegated OAuth posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.delegated-oauth-posture.v1",
            orgId: "org_1",
            generatedAt: "2026-01-01T00:00:00.000Z",
            status: "attention_required",
            warnings: ["delegated_oauth_access_token_expiring:github"],
            providers: [
              {
                id: "github",
                displayName: "GitHub",
                configured: true,
                connectorTypes: ["github"],
                authorizationHost: "github.com",
                tokenHost: "github.com",
                pkceRequired: true,
                defaultScopeCount: 1,
                connectionCounts: {
                  active: 1,
                  expiredAccessToken: 0,
                  expiringAccessToken: 1,
                  reauthorizationRequired: 0,
                  revoked: 0,
                  total: 1,
                  unused: 1,
                },
              },
            ],
            connectorTypes: [
              {
                connectorType: "github",
                connectionCounts: {
                  active: 1,
                  expiredAccessToken: 0,
                  expiringAccessToken: 1,
                  reauthorizationRequired: 0,
                  revoked: 0,
                  total: 1,
                  unused: 1,
                },
              },
            ],
            redaction: {
              rawAccessTokensReturned: false,
              rawClientSecretsReturned: false,
              rawProviderAccountIdsReturned: false,
              rawProviderAccountLoginsReturned: false,
              rawProviderUrlsReturned: false,
              rawRefreshTokensReturned: false,
            },
          },
        });
      },
    });

    await expect(client.admin.delegatedOAuthPosture()).resolves.toMatchObject({
      schema: "romeo.delegated-oauth-posture.v1",
      status: "attention_required",
      providers: [expect.objectContaining({ id: "github" })],
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/delegated-oauth/posture",
    );
  });

  it("reads browser automation posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.browser-automation-posture.v1",
            generatedAt: "2026-01-01T00:00:00.000Z",
            orgId: "org_1",
            status: "attention_required",
            backend: {
              approvalRequired: true,
              artifactUploadTtlSeconds: 900,
              maxArtifactBytes: 52428800,
              maxAttempts: 3,
              rawTaskReturnedOnlyOnActiveClaim: true,
              requiredWorkerScope: "tools:manage",
              workerQueue: "browser_automation",
              jobType: "workflow.browser_task.dispatch_request",
            },
            deployment: {
              liveEvidencePathConfigured: false,
              networkPolicyConfigured: false,
              runnerOriginConfigured: false,
              runnerUrlConfigured: false,
              workerEnabled: false,
              workerLeaseSeconds: 300,
              workerMaxBytes: 20000,
              workerMaxJobs: 5,
              workerTimeoutMs: 30000,
            },
            queue: {
              completed: 0,
              deadLettered: 0,
              failed: 0,
              oldestQueuedAgeSeconds: null,
              queued: 0,
              running: 0,
              staleQueued: 0,
              staleRunning: 0,
              total: 0,
            },
            artifacts: {
              allowedScreenshotContentTypes: ["image/png"],
              allowedTraceContentTypes: ["application/zip"],
              registeredCount: 0,
              taskCountWithRegisteredArtifacts: 0,
            },
            liveEvidence: {
              configured: false,
              source: "not_configured",
              status: "not_configured",
              checks: {
                reviewed_runner_sandbox: false,
                network_denial_enforced: false,
                worker_crash_retry: false,
                retention_worker_execution: false,
                pod_log_redaction: false,
              },
              failureCodes: [],
              redaction: {
                artifactBytesReturned: false,
                rawEvidencePathsReturned: false,
                rawPageContentReturned: false,
                rawRunnerUrlReturned: false,
                rawTaskTextReturned: false,
                secretValuesReturned: false,
              },
            },
            redaction: {
              evidenceFileBodiesReturned: false,
              rawArtifactStorageKeysReturned: false,
              rawEvidencePathsReturned: false,
              rawRunnerUrlReturned: false,
              rawTaskTextReturned: false,
              secretValuesReturned: false,
            },
            warnings: [
              "browser_automation_worker_not_enabled",
              "browser_automation_runner_not_configured",
              "browser_automation_network_policy_not_configured",
              "browser_automation_live_evidence_required",
            ],
          },
        });
      },
    });

    await expect(
      client.admin.browserAutomationPosture(),
    ).resolves.toMatchObject({
      schema: "romeo.browser-automation-posture.v1",
      status: "attention_required",
      liveEvidence: { status: "not_configured" },
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/browser-automation/posture",
    );
  });

  it("reads data connector posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.data-connector-posture.v1",
            generatedAt: "2026-01-01T00:00:00.000Z",
            orgId: "org_1",
            status: "attention_required",
            runtime: {
              executionDriver: "disabled",
              egressPolicy: "allow_public",
              managedFetchEnabled: false,
              allowedHostRuleCount: 0,
              fetchLimits: {
                maxBytes: 2000000,
                retryAttempts: 1,
                retryBackoffMs: 250,
                timeoutMs: 10000,
              },
              secretResolver: {
                driver: "disabled",
                managedSecretConfigured: false,
                externalValueResolverConfigured: false,
              },
              credentialPosture: {
                delegatedOAuthGithubConfigured: false,
                githubDeploymentTokenConfigured: false,
                s3DeploymentCredentialsConfigured: false,
                s3EndpointConfigured: false,
              },
            },
            deployment: {
              liveEvidencePathConfigured: false,
              networkPolicyConfigured: false,
              workerEnabled: false,
            },
            connectors: {
              active: 0,
              disabled: 0,
              due: 0,
              managed: 0,
              scheduled: 0,
              total: 0,
              byType: {
                local_import: 0,
                github: 0,
                s3: 0,
                website: 0,
                rss: 0,
                confluence: 0,
                jira: 0,
                notion: 0,
                linear: 0,
                slack: 0,
              },
            },
            syncs: {
              completed: 0,
              failed: 0,
              latestCompletedAt: null,
              latestFailedAt: null,
              running: 0,
              total: 0,
            },
            liveEvidence: {
              configured: false,
              source: "not_configured",
              status: "not_configured",
              checks: {
                managed_connector_sync_exercised: false,
                worker_cni_egress_enforced: false,
                dns_private_address_denied: false,
                secret_ref_resolution_verified: false,
                worker_crash_retry_or_requeue_verified: false,
                sync_log_redaction: false,
                sanitized_readback_verified: false,
              },
              failureCodes: [],
              summary: {
                delegatedOAuthConnectorCount: 0,
                deniedPrivateTargetCount: 0,
                failedSyncCount: 0,
                managedConnectorTypeCount: 0,
                podLogScanCount: 0,
                requeuedSyncCount: 0,
                secretRefConnectorCount: 0,
                successfulSyncCount: 0,
                syncAttemptCount: 0,
                workerLogScanCount: 0,
              },
              redaction: {
                rawAllowedHostsReturned: false,
                rawConnectorConfigReturned: false,
                rawConnectorContentReturned: false,
                rawEndpointUrlsReturned: false,
                rawEvidencePathsReturned: false,
                rawLogLinesReturned: false,
                rawSecretRefsReturned: false,
                secretValuesReturned: false,
                tokenValuesReturned: false,
              },
            },
            redaction: {
              evidenceFileBodiesReturned: false,
              rawAllowedHostsReturned: false,
              rawConnectorConfigReturned: false,
              rawConnectorContentReturned: false,
              rawEndpointUrlsReturned: false,
              rawEvidencePathsReturned: false,
              rawSecretRefsReturned: false,
              secretValuesReturned: false,
              tokenValuesReturned: false,
            },
            warnings: [
              "data_connector_driver_disabled",
              "data_connector_worker_not_enabled",
              "data_connector_network_policy_not_configured",
              "data_connector_live_evidence_required",
            ],
          },
        });
      },
    });

    await expect(client.admin.dataConnectorPosture()).resolves.toMatchObject({
      schema: "romeo.data-connector-posture.v1",
      status: "attention_required",
      liveEvidence: { status: "not_configured" },
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/data-connectors/posture",
    );
  });

  it("reads tool-dispatch posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.tool-dispatch-posture.v1",
            generatedAt: "2026-01-01T00:00:00.000Z",
            orgId: "org_1",
            status: "attention_required",
            backend: {
              activeLeaseRequiredForPayloadReadback: true,
              jobType: "tool.operation.dispatch_request",
              maxAttempts: 3,
              requiredWorkerScope: "tools:manage",
              terminalReadbackRejectsReplay: true,
              workerQueue: "external_tool_operations",
            },
            deployment: {
              externalOperationExecutionEnabled: false,
              liveEvidencePathConfigured: false,
              networkPolicyConfigured: false,
              operationExecutionDriver: "disabled",
              payloadEncryptionKeyConfigured: false,
              payloadStoreConfigured: false,
              payloadStoreDriver: "disabled",
              workerEnabled: false,
            },
            queue: {
              cancelled: 0,
              completed: 0,
              deadLettered: 0,
              expired: 0,
              failed: 0,
              oldestQueuedAgeSeconds: null,
              queued: 0,
              running: 0,
              staleQueued: 0,
              staleRunning: 0,
              total: 0,
            },
            payloadStorage: {
              externalWorkerSecretStoreRequired: 0,
              managedEncryptedObjectStore: 0,
              unknown: 0,
            },
            liveEvidence: {
              configured: false,
              source: "not_configured",
              status: "not_configured",
              checks: {
                worker_claim_execution_verified: false,
                managed_payload_read_verified: false,
                mcp_streamable_http_tools_call_verified: false,
                worker_cni_egress_enforced: false,
                dns_private_address_denied: false,
                secret_resolution_verified: false,
                worker_crash_retry_or_reclaim_verified: false,
                response_schema_validation_verified: false,
                worker_log_redaction: false,
                sanitized_readback_verified: false,
              },
              failureCodes: [],
              summary: {
                completedDispatchCount: 0,
                deniedPrivateTargetCount: 0,
                dispatchRequestCount: 0,
                failedDispatchCount: 0,
                managedPayloadReadCount: 0,
                podLogScanCount: 0,
                reclaimedDispatchCount: 0,
                schemaValidationCount: 0,
                secretResolutionCount: 0,
                workerLogScanCount: 0,
              },
              mcp: {
                streamableHttpToolsCallVerified: false,
                protocolHeadersVerified: false,
                jsonRpcEnvelopeVerified: false,
                callCount: 0,
                payloadArgumentsRedacted: false,
                outputRedacted: false,
              },
              redaction: {
                rawEvidencePathsReturned: false,
                rawLogLinesReturned: false,
                rawObjectStoreKeysReturned: false,
                rawOperationHostsReturned: false,
                rawPayloadValuesReturned: false,
                rawResponseBodiesReturned: false,
                rawSecretRefsReturned: false,
                secretValuesReturned: false,
                tokenValuesReturned: false,
              },
            },
            redaction: {
              evidenceFileBodiesReturned: false,
              rawEvidencePathsReturned: false,
              rawObjectStoreKeysReturned: false,
              rawOperationHostsReturned: false,
              rawPayloadValuesReturned: false,
              rawResponseBodiesReturned: false,
              rawSecretRefsReturned: false,
              secretValuesReturned: false,
              tokenValuesReturned: false,
            },
            warnings: [
              "tool_dispatch_execution_disabled",
              "tool_dispatch_worker_not_enabled",
              "tool_dispatch_network_policy_not_configured",
              "tool_dispatch_managed_payload_store_disabled",
              "tool_dispatch_live_evidence_required",
            ],
          },
        });
      },
    });

    await expect(client.admin.toolDispatchPosture()).resolves.toMatchObject({
      schema: "romeo.tool-dispatch-posture.v1",
      status: "attention_required",
      liveEvidence: {
        status: "not_configured",
        mcp: { streamableHttpToolsCallVerified: false },
      },
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/tool-dispatch/posture",
    );
  });

  it("reads voice provider live posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.voice-provider-live-posture.v1",
            generatedAt: "2026-01-01T00:00:00.000Z",
            orgId: "org_1",
            status: "ready",
            runtime: {
              catalogVoiceCount: 1,
              liveEvidencePathConfigured: true,
              providerCredentialConfigured: true,
              providerDriver: "openai-compatible",
              transcriptionModelConfigured: true,
              ttsModelConfigured: true,
            },
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.voice-provider-live-evidence.v1",
              generatedAt: "2026-01-01T00:00:00.000Z",
              evidenceStatus: "passed",
              mode: "live",
              deployment: "kubernetes",
              failureCodes: [],
            },
            checks: {
              total: 8,
              requiredTotal: 8,
              requiredPresent: 8,
              missingRequired: [],
            },
            provider: {
              driver: "openai-compatible",
              catalogSyncCount: 1,
              configuredVoiceCount: 1,
              providerFailureRedacted: true,
              transcriptionRequestCount: 1,
              ttsRequestCount: 1,
            },
            tts: {
              livePreviewVerified: true,
              generatedArtifactCount: 1,
              generatedAudioBytes: 44,
            },
            transcription: {
              liveTranscriptionVerified: true,
              audioBytes: 4,
              promptProvided: true,
              transcriptLength: 24,
            },
            artifacts: {
              readbackVerified: true,
              readbackBytes: 44,
              deleteVerified: true,
              deletedArtifactCount: 1,
            },
            streamingConsent: {
              streamingEnabled: false,
              reviewed: true,
              reviewedPolicyCount: 0,
            },
            logRedaction: {
              appLogRedactionVerified: true,
              podLogRedactionVerified: true,
              appLogScanCount: 1,
              podLogScanCount: 1,
              rawAudioSentinelHitCount: 0,
              rawSpeechTextSentinelHitCount: 0,
              rawTranscriptSentinelHitCount: 0,
              secretSentinelHitCount: 0,
            },
            redaction: {
              evidenceFileBodyReturned: false,
              rawAudioReturned: false,
              rawEvidencePathsReturned: false,
              rawObjectStoreKeysReturned: false,
              rawProviderEndpointReturned: false,
              rawProviderResponseReturned: false,
              rawSpeechTextReturned: false,
              rawTranscriptTextReturned: false,
              secretValuesReturned: false,
              tokenValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    await expect(
      client.admin.voiceProviderLivePosture(),
    ).resolves.toMatchObject({
      schema: "romeo.voice-provider-live-posture.v1",
      status: "ready",
      evidence: { status: "satisfied" },
      redaction: { rawAudioReturned: false },
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/voice/provider-live-posture",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads notification adapter live posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.notification-adapter-live-posture.v1",
            generatedAt: "2026-01-01T00:00:00.000Z",
            orgId: "org_1",
            status: "ready",
            runtime: {
              deliveryDriver: "configured",
              emailDeliveryDriver: "resend",
              fcmConfigured: true,
              liveEvidencePathConfigured: true,
              pagerDutyConfigured: true,
              providerEndpointCount: 4,
              resendConfigured: true,
              secretResolverConfigured: true,
              smtpConfigured: true,
            },
            evidence: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.notification-adapter-live-evidence.v1",
              generatedAt: "2026-01-01T00:00:00.000Z",
              evidenceStatus: "passed",
              mode: "live",
              deployment: "kubernetes",
              failureCodes: [],
            },
            checks: {
              total: 9,
              requiredTotal: 9,
              requiredPresent: 9,
              missingRequired: [],
            },
            delivery: {
              attemptedCount: 7,
              deliveryDriver: "configured",
              failedCount: 1,
              providerFamilyCount: 6,
              providerPayloadRedacted: true,
              successfulCount: 6,
            },
            channels: {
              emailCount: 1,
              mobilePushCount: 1,
              mixedChannelTypesVerified: true,
              pagerDutyCount: 1,
              slackCount: 1,
              teamsCount: 1,
              total: 6,
              webhookCount: 1,
            },
            secrets: {
              secretRefResolutionCount: 3,
              secretResolverBoundaryVerified: true,
            },
            policy: {
              channelTypeIsolationVerified: true,
              deadLetterCount: 1,
              retrySuccessCount: 1,
              suppressionVerified: true,
            },
            egress: {
              hostAllowlistEnforced: true,
              networkPolicyEnforced: true,
              privateNetworkDenied: true,
              providerEndpointAccessVerified: true,
            },
            logRedaction: {
              appLogRedactionVerified: true,
              appLogScanCount: 1,
              bodySentinelHitCount: 0,
              destinationSentinelHitCount: 0,
              podLogRedactionVerified: true,
              podLogScanCount: 1,
              secretSentinelHitCount: 0,
              tokenSentinelHitCount: 0,
            },
            redaction: {
              evidenceFileBodyReturned: false,
              rawDestinationsReturned: false,
              rawEndpointUrlsReturned: false,
              rawEvidencePathsReturned: false,
              rawLogLinesReturned: false,
              rawMessageBodiesReturned: false,
              rawProviderResponsesReturned: false,
              rawSecretRefsReturned: false,
              secretValuesReturned: false,
              tokenValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    await expect(
      client.admin.notificationAdapterLivePosture(),
    ).resolves.toMatchObject({
      schema: "romeo.notification-adapter-live-posture.v1",
      status: "ready",
      evidence: { status: "satisfied" },
      redaction: { rawDestinationsReturned: false },
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/notifications/adapter-live-posture",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads Kubernetes evidence posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.kubernetes-posture.v1",
            generatedAt: "2026-07-03T00:00:00.000Z",
            orgId: "org_default",
            status: "ready",
            summary: {
              total: 9,
              requiredTotal: 7,
              configured: 7,
              notConfigured: 2,
              invalid: 0,
              planned: 0,
              failed: 0,
              satisfied: 7,
              requiredSatisfied: 7,
              requiredMissing: 0,
            },
            evidence: [
              {
                kind: "live_smoke",
                gateId: "phase21.kubernetes_live_smoke",
                label: "Kubernetes live namespace smoke",
                required: true,
                configured: true,
                source: "configured_file",
                status: "satisfied",
                schemaVersion: "romeo.kubernetes-live-smoke.v1",
                generatedAt: "2026-07-03T00:00:00.000Z",
                evidenceStatus: "passed",
                mode: "live",
                failureCodes: [],
                checks: {
                  total: 12,
                  requiredTotal: 12,
                  requiredPresent: 12,
                  missingRequired: [],
                },
                target: {
                  deployment: "kubernetes",
                  namespaceConfigured: true,
                  releaseConfigured: true,
                  serviceConfigured: true,
                  deploymentConfigured: true,
                },
                logRedaction: {
                  configured: true,
                  status: "passed",
                  scanCount: 4,
                  sentinelCheckCount: 13,
                },
                metrics: {},
              },
              {
                kind: "tiered_rag",
                gateId: "phase32.kubernetes_tiered_rag_smoke",
                label: "Kubernetes tiered-RAG isolation smoke",
                required: true,
                configured: true,
                source: "configured_file",
                status: "satisfied",
                schemaVersion: "romeo.kubernetes-tiered-rag-smoke.v1",
                generatedAt: "2026-07-03T00:05:00.000Z",
                evidenceStatus: "passed",
                mode: "live",
                failureCodes: [],
                checks: {
                  total: 8,
                  requiredTotal: 8,
                  requiredPresent: 8,
                  missingRequired: [],
                },
                target: {
                  deployment: "kubernetes",
                  namespaceConfigured: true,
                  releaseConfigured: true,
                  serviceConfigured: true,
                  deploymentConfigured: true,
                },
                logRedaction: {
                  configured: true,
                  status: "passed",
                  scanCount: 2,
                  sentinelCheckCount: 7,
                },
                metrics: {
                  authorizedTierCount: 4,
                  skippedDeniedCount: 1,
                  vectorPlanEntryCount: 4,
                },
                vectorPosture: {
                  driver: "qdrant",
                  isolationMode: "external_namespace_per_org",
                  externalVectorStoreDriver: "qdrant",
                  externalVectorStoreRoutingActive: true,
                  namespaceConfigured: true,
                  namespacePolicy: "knowledge_base",
                  partitioningConfigured: true,
                  partitioningPolicy: "org",
                  planEntryCount: 4,
                  vectorScopeDriverCounts: {
                    pgvector: 0,
                    qdrant: 4,
                  },
                },
              },
            ],
            redaction: {
              databaseUrlsReturned: false,
              evidenceFileBodiesReturned: false,
              kubernetesObjectBodiesReturned: false,
              podLogsReturned: false,
              rawEvidencePathsReturned: false,
              rawImageRefsReturned: false,
              rawNamespaceValuesReturned: false,
              secretValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const posture = await client.admin.kubernetesPosture();

    expect(posture.schema).toBe("romeo.kubernetes-posture.v1");
    expect(posture.summary.requiredSatisfied).toBe(7);
    expect(posture.evidence[0]?.kind).toBe("live_smoke");
    expect(posture.evidence[1]?.vectorPosture?.driver).toBe("qdrant");
    expect(posture.redaction.podLogsReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/kubernetes/posture",
    );
  });

  it("reads release readback posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.release-readback-posture.v1",
            generatedAt: "2026-07-03T04:10:00.000Z",
            orgId: "org_1",
            status: "ready",
            summary: {
              planReady: true,
              readbackSatisfied: true,
              validationPassed: true,
              requiredPackageCount: 1,
              requiredImageCount: 1,
              requiredChartCount: 1,
              requiredAssetCount: 5,
              requiredReleaseAssetNamesFound: [
                "release-channel",
                "security-evidence",
                "sbom",
                "provenance",
                "approval",
              ],
              validationCheckCount: 8,
              validationChecksPassed: 8,
              validationChecksFailed: 0,
            },
            plan: {
              configured: true,
              source: "configured_file",
              status: "ready",
              schemaVersion: "romeo.release-readback-plan.v1",
              failureCodes: [],
              helmRepositoryConfigured: true,
              images: { total: 1, digestPinned: 1, requiredMatched: 1 },
              charts: { total: 1, digestPinned: 1, requiredMatched: 1 },
              assets: {
                total: 5,
                digestPinned: 5,
                requiredMatched: 5,
                requiredReleaseAssetNamesFound: [
                  "release-channel",
                  "security-evidence",
                  "sbom",
                  "provenance",
                  "approval",
                ],
                requiredReleaseAssetNamesMissing: [],
              },
            },
            readback: {
              configured: true,
              source: "configured_file",
              status: "satisfied",
              schemaVersion: "romeo.release-readback.v1",
              generatedAt: "2026-07-03T04:00:00.000Z",
              mode: "live_registry_readback",
              evidenceStatus: "collected",
              release: { name: "romeo", version: "1.2.3" },
              registries: {
                npmCredentialsUsed: true,
                ociCredentialsUsed: true,
                helmCredentialsUsed: true,
                assetCredentialsUsed: true,
              },
              artifacts: {
                packages: 1,
                images: 1,
                ociRegistryImages: 1,
                charts: 1,
                helmRepositoryCharts: 1,
                assets: 5,
                releaseAssets: 5,
              },
              failureCodes: [],
            },
            validation: {
              configured: true,
              source: "configured_file",
              status: "passed",
              schemaVersion: "romeo.release-readback-validation.v1",
              generatedAt: "2026-07-03T04:05:00.000Z",
              mode: "live_readback",
              validationStatus: "pass",
              release: { name: "romeo", version: "1.2.3" },
              required: {
                packages: 1,
                images: 1,
                charts: 1,
                assets: 5,
                requiredReleaseAssetNamesFound: [
                  "release-channel",
                  "security-evidence",
                  "sbom",
                  "provenance",
                  "approval",
                ],
                requiredReleaseAssetNamesMissing: [],
              },
              verified: {
                credentialedNpmRegistry: true,
                images: 1,
                charts: 1,
                releaseAssets: 5,
              },
              checks: { total: 8, passed: 8, failed: 0 },
              redactionProof: {
                status: "passed",
                requiredFlagCount: 8,
                safeFlagCount: 8,
                unsafeFlagCount: 0,
                missingFlagCount: 0,
              },
              failureCodes: [],
            },
            redaction: {
              evidenceFileBodiesReturned: false,
              helmRepositoryUrlsReturned: false,
              ociImageRefsReturned: false,
              packageRegistryUrlsReturned: false,
              packageTarballsReturned: false,
              rawEvidencePathsReturned: false,
              rawHelmRepositoryBodiesReturned: false,
              rawOciManifestsReturned: false,
              rawReadbackBodiesReturned: false,
              rawRegistryResponsesReturned: false,
              releaseAssetUrlsReturned: false,
              secretValuesReturned: false,
              tokenValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const posture = await client.admin.releaseReadbackPosture();

    expect(posture.schema).toBe("romeo.release-readback-posture.v1");
    expect(posture.status).toBe("ready");
    expect(posture.summary.requiredAssetCount).toBe(5);
    expect(posture.validation.redactionProof.status).toBe("passed");
    expect(posture.redaction.tokenValuesReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/release-readback/posture",
    );
  });

  it("reads release security posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.release-security-posture.v1",
            generatedAt: "2026-07-03T05:20:00.000Z",
            orgId: "org_1",
            status: "ready",
            summary: {
              provenancePassed: true,
              approvalPassed: true,
              publishPlanReady: true,
              airgapVerified: true,
              signedProvenanceAttached: true,
              approvalMinApproversSatisfied: true,
              releaseVersionConsistent: true,
              totalCheckCount: 7,
              passedCheckCount: 7,
              failedCheckCount: 0,
              blockerCount: 0,
            },
            provenance: {
              configured: true,
              source: "configured_file",
              status: "passed",
              schemaVersion: "romeo.release-provenance.v1",
              generatedAt: "2026-07-03T05:00:00.000Z",
              release: { name: "romeo", version: "1.2.3" },
              sourcePosture: {
                commitShaConfigured: true,
                sourceRepoConfigured: true,
                sourceRefConfigured: true,
                builderIdConfigured: true,
                ciRunUrlConfigured: true,
              },
              supplyChain: {
                sbomAttached: true,
                securityEvidenceAttached: true,
                releaseChannelAttached: true,
                signatureAttached: true,
                attestationAttached: false,
                signatureRequired: true,
                attestationRequired: false,
                ciSourceRequired: true,
              },
              checks: {
                total: 2,
                passed: 2,
                failed: 0,
                planned: 0,
                unknown: 0,
              },
              blockers: { total: 0, codes: [] },
              redactionSafe: true,
            },
            approval: {
              configured: true,
              source: "configured_file",
              status: "passed",
              schemaVersion: "romeo.release-approval.v1",
              generatedAt: "2026-07-03T05:05:00.000Z",
              release: { name: "romeo", version: "1.2.3" },
              approval: {
                systemConfigured: true,
                refConfigured: true,
                approverCount: 2,
                minApprovers: 2,
                minApproversSatisfied: true,
                approvedAtConfigured: true,
                expiresAtConfigured: false,
                expiredAtGeneration: false,
              },
              checks: {
                total: 2,
                passed: 2,
                failed: 0,
                planned: 0,
                unknown: 0,
              },
              blockers: { total: 0, codes: [] },
              redactionSafe: true,
            },
            publishPlan: {
              configured: true,
              source: "configured_file",
              status: "ready",
              schemaVersion: "romeo.release-publish-plan.v1",
              generatedAt: "2026-07-03T05:10:00.000Z",
              release: { name: "romeo", version: "1.2.3" },
              artifacts: { total: 2, packageArtifacts: 2 },
              evidence: {
                securityEvidenceIncluded: true,
                provenanceIncluded: true,
                approvalIncluded: true,
                releaseNotesIncluded: true,
              },
              policy: {
                npmProvenance: true,
                requireApproval: true,
                requireSignedProvenance: true,
              },
              steps: {
                total: 5,
                registryPublish: 2,
                gitTag: 1,
                gitPush: 1,
                releaseAssetPublish: 1,
              },
              blockers: { total: 0, codes: [] },
            },
            airgap: {
              configured: true,
              source: "configured_file",
              status: "passed",
              schemaVersion: "romeo.airgap-bundle-verification.v1",
              generatedAt: "2026-07-03T05:15:00.000Z",
              release: { name: "romeo", version: "1.2.3" },
              requirements: {
                gaBundle: true,
                publishPlan: true,
                releaseReadback: true,
                readbackValidation: true,
                signedProvenance: true,
                approval: true,
              },
              bundle: {
                artifactCount: 2,
                evidenceFileCount: 10,
                totalBytes: 12345,
                inventoryHashPresent: true,
              },
              files: {
                manifest: true,
                channel: true,
                securityEvidence: true,
                sbom: true,
                provenance: true,
                approval: true,
                gaBundle: true,
                publishPlan: true,
                releaseReadback: true,
                readbackValidation: true,
              },
              checks: {
                total: 3,
                passed: 3,
                failed: 0,
                planned: 0,
                unknown: 0,
              },
              blockers: { total: 0, codes: [] },
              redactionSafe: true,
            },
            redaction: {
              airgapBundlePathsReturned: false,
              approvalRefsReturned: false,
              approverIdsReturned: false,
              artifactBodiesReturned: false,
              attestationBodiesReturned: false,
              ciRunUrlsReturned: false,
              commandLinesReturned: false,
              environmentValuesReturned: false,
              evidenceFileBodiesReturned: false,
              gitRemotesReturned: false,
              rawEvidencePathsReturned: false,
              registryUrlsReturned: false,
              secretValuesReturned: false,
              signatureBodiesReturned: false,
              sourceRefsReturned: false,
              sourceReposReturned: false,
              tokenValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const posture = await client.admin.releaseSecurityPosture();

    expect(posture.schema).toBe("romeo.release-security-posture.v1");
    expect(posture.status).toBe("ready");
    expect(posture.summary.airgapVerified).toBe(true);
    expect(posture.approval.approval.minApproversSatisfied).toBe(true);
    expect(posture.publishPlan.steps.registryPublish).toBe(2);
    expect(posture.redaction.commandLinesReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/release-security/posture",
    );
  });

  it("reads support bundle posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.support-bundle-posture.v1",
            generatedAt: "2026-07-03T00:00:00.000Z",
            orgId: "org_1",
            status: "ready",
            summary: {
              bundleGenerated: true,
              redactionPassed: true,
              evidenceFileCount: 3,
              accessReviewEvidenceCount: 1,
              logFileCount: 2,
              migrationFileCount: 1,
              deploymentFileCount: 2,
              configuredSecretCount: 4,
              redactionCheckCount: 7,
              requiredRedactionCheckCount: 7,
              missingRequiredRedactionCheckCount: 0,
            },
            bundle: {
              configured: true,
              source: "configured_file",
              status: "generated",
              schemaVersion: "romeo.support-bundle.v1",
              generatedAt: "2026-07-03T00:00:00.000Z",
              package: {
                nameConfigured: true,
                versionConfigured: true,
                packageManagerConfigured: true,
              },
              runtime: {
                nodeConfigured: true,
                platformConfigured: true,
                archConfigured: true,
              },
              configuration: {
                safeEnumCount: 8,
                configuredSafeEnumCount: 8,
                unrecognizedSafeEnumCount: 0,
                safeNumberCount: 5,
                configuredSecretCount: 4,
                urlHostConfiguredCount: 2,
              },
              deployment: { fileCount: 2 },
              migrations: { count: 1, greenfieldBaselineOnly: true },
              evidence: {
                fileCount: 3,
                schemaVersionCount: 3,
                generatedStatusCount: 3,
                releaseVersionCount: 2,
              },
              complianceEvidence: {
                accessReviewStatus: "present",
                accessReviewCount: 1,
              },
              dataRights: {
                coverageApiPathConfigured: true,
                exportApisConfigured: true,
                deletionApisConfigured: true,
                supportedDeletionResourceTypeCount: 2,
                retentionEvidenceSchemaConfigured: true,
                operationalLogEvidencePathConfigured: true,
                backupEvidencePathConfigured: true,
                externalRetentionControlCount: 2,
              },
              logs: { count: 2 },
              redactionSafe: true,
              failureCodes: [],
            },
            redactionEvidence: {
              configured: true,
              source: "configured_file",
              status: "passed",
              schemaVersion: "romeo.support-bundle-redaction.v1",
              generatedAt: "2026-07-03T00:01:00.000Z",
              checks: {
                total: 7,
                requiredTotal: 7,
                requiredPresent: 7,
                missingRequired: [],
              },
              supportBundle: {
                schemaVersion: "romeo.support-bundle.v1",
                evidenceCount: 3,
                accessReviewEvidenceCount: 1,
                logCount: 2,
                migrationCount: 1,
                configuredSecretCount: 4,
              },
              redactionSafe: true,
              failureCodes: [],
            },
            redaction: {
              accessReviewBodiesReturned: false,
              backupLocationsReturned: false,
              connectorPayloadsReturned: false,
              environmentValuesReturned: false,
              evidenceFileBodiesReturned: false,
              logBodiesReturned: false,
              objectStoreKeysReturned: false,
              packageEvidencePathsReturned: false,
              promptsReturned: false,
              providerPayloadsReturned: false,
              rawEvidencePathsReturned: false,
              reportBodiesReturned: false,
              secretValuesReturned: false,
              tokenValuesReturned: false,
              vectorValuesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const posture = await client.admin.supportBundlePosture();

    expect(posture.schema).toBe("romeo.support-bundle-posture.v1");
    expect(posture.status).toBe("ready");
    expect(posture.summary.redactionPassed).toBe(true);
    expect(posture.bundle.migrations.greenfieldBaselineOnly).toBe(true);
    expect(posture.redactionEvidence.checks.requiredPresent).toBe(7);
    expect(posture.redaction.rawEvidencePathsReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/support-bundle/posture",
    );
  });

  it("reads CI governance posture through the admin resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schema: "romeo.ci-governance-posture.v1",
            generatedAt: "2026-07-03T04:35:00.000Z",
            orgId: "org_1",
            status: "ready",
            summary: {
              planReady: true,
              hostedRunVerified: true,
              branchProtectionVerified: true,
              requiredStatusCheckCount: 14,
              requiredWorkflowCommandCount: 51,
              totalCheckCount: 68,
              passedCheckCount: 68,
              failedCheckCount: 0,
              plannedCheckCount: 0,
              blockerCount: 0,
            },
            plan: {
              configured: true,
              source: "configured_file",
              status: "passed",
              schemaVersion: "romeo.branch-protection-plan.v1",
              generatedAt: "2026-07-03T04:20:00.000Z",
              provider: "github",
              workflow: { configured: true, jobCount: 5 },
              policy: {
                requirePullRequest: true,
                requireConversationResolution: true,
                requireLinearHistory: true,
                requireSignedCommits: true,
                requireUpToDateBeforeMerge: true,
                dismissStaleApprovals: true,
                restrictBypassToReleaseAdmins: true,
                requireCodeOwnerReviews: true,
                requiredApprovingReviewCount: 2,
              },
              requiredStatusCheckCount: 14,
              requiredWorkflowCommandCount: 51,
              checks: {
                total: 51,
                passed: 51,
                failed: 0,
                planned: 0,
                unknown: 0,
              },
              blockers: { total: 0, codes: [] },
              redactionSafe: true,
            },
            hostedRun: {
              configured: true,
              source: "configured_file",
              status: "passed",
              schemaVersion: "romeo.hosted-ci-run-verification.v1",
              generatedAt: "2026-07-03T04:25:00.000Z",
              mode: "live_github_api",
              provider: "github_actions",
              plan: {
                status: "passed",
                requiredStatusCheckCount: 14,
              },
              run: {
                observed: true,
                completed: true,
                successful: true,
              },
              jobs: {
                inventoryRead: true,
                observedJobCount: 14,
                missingRequiredJobCount: 0,
                failedRequiredJobCount: 0,
              },
              checks: {
                total: 6,
                passed: 6,
                failed: 0,
                planned: 0,
                unknown: 0,
              },
              blockers: { total: 0, codes: [] },
              redactionSafe: true,
            },
            branchProtection: {
              configured: true,
              source: "configured_file",
              status: "passed",
              schemaVersion: "romeo.branch-protection-verification.v1",
              generatedAt: "2026-07-03T04:30:00.000Z",
              mode: "live_github_api",
              provider: "github",
              plan: {
                status: "passed",
                requiredStatusCheckCount: 14,
                policy: {
                  requirePullRequest: true,
                  requireConversationResolution: true,
                  requireLinearHistory: true,
                  requireSignedCommits: true,
                  requireUpToDateBeforeMerge: true,
                  dismissStaleApprovals: true,
                  restrictBypassToReleaseAdmins: false,
                  requireCodeOwnerReviews: true,
                  requiredApprovingReviewCount: 2,
                },
              },
              controls: {
                evaluatedCount: 11,
                passedCount: 11,
                failedCount: 0,
                plannedCount: 0,
              },
              checks: {
                total: 11,
                passed: 11,
                failed: 0,
                planned: 0,
                unknown: 0,
              },
              blockers: { total: 0, codes: [] },
              redactionSafe: true,
            },
            redaction: {
              branchNamesReturned: false,
              evidenceFileBodiesReturned: false,
              jobLogsReturned: false,
              rawApiResponsesReturned: false,
              rawEvidencePathsReturned: false,
              rawStatusCheckNamesReturned: false,
              repositorySlugsReturned: false,
              runUrlsReturned: false,
              secretValuesReturned: false,
              tokenValuesReturned: false,
              workflowBodiesReturned: false,
            },
            warnings: [],
          },
        });
      },
    });

    const posture = await client.admin.ciGovernancePosture();

    expect(posture.schema).toBe("romeo.ci-governance-posture.v1");
    expect(posture.status).toBe("ready");
    expect(posture.summary.requiredStatusCheckCount).toBe(14);
    expect(posture.hostedRun.jobs.inventoryRead).toBe(true);
    expect(posture.redaction.repositorySlugsReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/admin/ci-governance/posture",
    );
  });

  it("reads tool connector catalog through the tool resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            schemaVersion: "romeo.tool-connector-catalog.v1",
            entries: [
              {
                type: "openapi",
                displayName: "OpenAPI imported operations",
                description: "Worker-dispatched imported operations.",
                implementationStatus: "implemented",
                creationMode: "openapi_import",
                executionBoundary: "external_worker_dispatch",
                operationDiscovery: "openapi_import",
                supportsAuthConfig: true,
                supportsNetworkPolicy: true,
                supportsModelToolInjection: true,
                credentialSources: ["managed_secret_ref"],
                requiredScopes: ["tools:manage"],
                securityControls: ["host allowlist required"],
                blockedReasons: [],
              },
            ],
            redaction: {
              rawConnectorConfigsReturned: false,
              rawEndpointUrlsReturned: false,
              rawSecretRefsReturned: false,
              secretValuesReturned: false,
            },
          },
        });
      },
    });

    const catalog = await client.tool.catalog();

    expect(catalog.schemaVersion).toBe("romeo.tool-connector-catalog.v1");
    expect(catalog.entries[0]?.type).toBe("openapi");
    expect(catalog.redaction.rawSecretRefsReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/tool-connectors/catalog",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("creates webhook tool connectors through the tool resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            connector: {
              id: "connector_1",
              type: "webhook",
              name: "Incident intake",
            },
            operations: [{ id: "operation_1", operationId: "invokeWebhook" }],
          },
        });
      },
    });

    const created = await client.tool.createWebhookConnector({
      name: "Incident intake",
      description: "Create an incident record.",
      operationName: "Create incident",
      url: "https://hooks.example.com/romeo/incidents",
      bodySchema: {
        type: "object",
        properties: { incidentId: { type: "string" } },
        required: ["incidentId"],
      },
    });

    expect(created.connector.id).toBe("connector_1");
    expect(created.operations[0]?.operationId).toBe("invokeWebhook");
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/tools/webhook");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        name: "Incident intake",
        description: "Create an incident record.",
        operationName: "Create incident",
        url: "https://hooks.example.com/romeo/incidents",
        bodySchema: {
          type: "object",
          properties: { incidentId: { type: "string" } },
          required: ["incidentId"],
        },
      }),
    );
  });

  it("creates MCP tool connectors through the tool resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            connector: {
              id: "connector_mcp",
              type: "mcp",
              name: "Research MCP",
            },
            operations: [{ id: "operation_1", operationId: "search.docs" }],
          },
        });
      },
    });

    const created = await client.tool.createMcpConnector({
      name: "Research MCP",
      description: "Reviewed MCP server manifest.",
      serverUrl: "https://mcp.example.com/mcp",
      protocolVersion: "2025-06-18",
      tools: [
        {
          name: "search.docs",
          description: "Search approved docs.",
          approvalPolicy: "never",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    });

    expect(created.connector.id).toBe("connector_mcp");
    expect(created.operations[0]?.operationId).toBe("search.docs");
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/tools/mcp");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        name: "Research MCP",
        description: "Reviewed MCP server manifest.",
        serverUrl: "https://mcp.example.com/mcp",
        protocolVersion: "2025-06-18",
        tools: [
          {
            name: "search.docs",
            description: "Search approved docs.",
            approvalPolicy: "never",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        ],
      }),
    );
  });

  it("manages tool connector readiness through the tool resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        if (calls.length === 1)
          return jsonResponse({ data: { id: "connector_1", enabled: true } });
        if (calls.length === 2)
          return jsonResponse({
            data: {
              id: "operation_1",
              operationId: "listIssues",
              enabled: true,
            },
          });
        if (calls.length === 3)
          return jsonResponse({
            data: {
              id: "connector_1",
              authConfig: {
                type: "api_key",
                apiKeyIn: "query",
                apiKeyName: "api_key",
              },
            },
          });
        if (calls.length === 4)
          return jsonResponse({
            data: {
              connectorId: "connector_1",
              configured: true,
              available: true,
              secretRefScheme: "vault",
              checkedAt: "",
            },
          });
        if (calls.length === 5) {
          return jsonResponse({
            data: {
              job: {
                id: "job_1",
                type: "tool.operation.dispatch",
                status: "completed",
              },
              connectorId: "connector_1",
              operationId: "listIssues",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              request: {
                parameterKeys: ["issueId"],
                bodyKeys: [],
                host: "api.example.com",
                authInjected: true,
              },
              response: {
                ok: true,
                status: 200,
                contentType: "application/json",
                bodyBytes: 12,
                truncated: false,
                schemaValidation: { status: "passed" },
              },
            },
          });
        }
        if (calls.length === 6) {
          return jsonResponse({
            data: {
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "queued",
              },
              connectorId: "connector_1",
              operationId: "listIssues",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              request: {
                parameterKeys: ["issueId"],
                bodyKeys: ["title"],
                host: "api.example.com",
                payloadStorage: "external_worker_secret_store_required",
              },
              approval: {
                required: true,
                approvalPolicy: "external_side_effects",
                riskLevel: "medium",
                approvalRequestId: "job_approval",
              },
              idempotency: { replayed: false },
            },
          });
        }
        if (calls.length === 7) {
          return jsonResponse({
            data: {
              claimed: true,
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "running",
              },
              connectorId: "connector_1",
              operationId: "listIssues",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              request: {
                parameterKeys: ["issueId"],
                bodyKeys: ["title"],
                host: "api.example.com",
                payloadStorage: "external_worker_secret_store_required",
              },
              lease: {
                workerId: "svc_worker",
                claimedAt: "2026-06-30T00:00:00.000Z",
                renewedAt: "2026-06-30T00:00:00.000Z",
                expiresAt: "2026-06-30T00:05:00.000Z",
                leaseSeconds: 300,
                attempt: 1,
              },
            },
          });
        }
        if (calls.length === 8) {
          return jsonResponse({
            data: {
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "running",
              },
              connectorId: "connector_1",
              operationId: "listIssues",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              request: {
                parameterKeys: ["issueId"],
                bodyKeys: ["title"],
                host: "api.example.com",
                payloadStorage: "managed_encrypted_object_store",
              },
              payload: {
                parameters: { issueId: "ISSUE-1" },
                body: { title: "Write it" },
                auth: { type: "bearer", secretRef: "env://TOOL_API_KEY" },
              },
            },
          });
        }
        if (calls.length === 9) {
          return jsonResponse({
            data: {
              claimed: true,
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "running",
              },
              workerQueue: "external_tool_operations",
              lease: {
                workerId: "svc_worker",
                claimedAt: "2026-06-30T00:00:00.000Z",
                renewedAt: "2026-06-30T00:02:00.000Z",
                expiresAt: "2026-06-30T00:12:00.000Z",
                leaseSeconds: 600,
                attempt: 1,
              },
            },
          });
        }
        if (calls.length === 10) {
          return jsonResponse({
            data: {
              expired: 1,
              workerQueue: "external_tool_operations",
              jobs: [
                {
                  job: {
                    id: "job_5",
                    type: "tool.operation.dispatch_request",
                    status: "failed",
                  },
                  connectorId: "connector_1",
                  operationId: "listIssues",
                  method: "get",
                  pathTemplate: "/issues/{issueId}",
                  reasonCode: "queued_timeout",
                },
              ],
            },
          });
        }
        if (calls.length === 11) {
          return jsonResponse({
            data: {
              job: {
                id: "job_2",
                type: "tool.operation.dispatch_request",
                status: "completed",
              },
              connectorId: "connector_1",
              operationId: "listIssues",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "completed",
              response: {
                ok: true,
                status: 202,
                bodyBytes: 12,
                truncated: false,
                schemaValidation: { status: "passed" },
              },
            },
          });
        }
        if (calls.length === 12) {
          return jsonResponse({
            data: {
              job: {
                id: "job_3",
                type: "tool.operation.dispatch_request",
                status: "failed",
              },
              connectorId: "connector_1",
              operationId: "listIssues",
              method: "get",
              pathTemplate: "/issues/{issueId}",
              workerQueue: "external_tool_operations",
              outcome: "failed",
              errorCode: "worker_failed",
            },
          });
        }
        return jsonResponse({
          data: {
            job: {
              id: "job_4",
              type: "tool.operation.dispatch_request",
              status: "failed",
            },
            connectorId: "connector_1",
            operationId: "listIssues",
            method: "get",
            pathTemplate: "/issues/{issueId}",
            workerQueue: "external_tool_operations",
            outcome: "cancelled",
            errorCode: "worker_cancelled",
          },
        });
      },
    });

    const connector = await client.tool.updateConnector({
      connectorId: "connector/1",
      enabled: true,
    });
    const operation = await client.tool.updateOperation({
      connectorId: "connector/1",
      operationId: "list/issues",
      enabled: true,
    });
    const authed = await client.tool.updateConnectorAuth({
      connectorId: "connector/1",
      type: "api_key",
      secretRef: "env://TOOL_API_KEY",
      apiKeyIn: "query",
      apiKeyName: "api_key",
    });
    const check = await client.tool.checkConnectorAuth("connector/1");
    const dispatch = await client.tool.dispatchOperation({
      connectorId: "connector/1",
      operationId: "list/issues",
      approved: true,
      approvalRequestId: "job_approval",
      parameters: { issueId: "ISSUE-1" },
    });
    const queued = await client.tool.enqueueDispatchOperation({
      connectorId: "connector/1",
      operationId: "list/issues",
      approved: true,
      approvalRequestId: "job_approval",
      idempotencyKey: "dispatch-key-1",
      parameters: { issueId: "ISSUE-1" },
      body: { title: "Write it" },
    });
    const claimed = await client.tool.claimDispatchRequest({
      leaseSeconds: 300,
      payloadStorage: "managed_encrypted_object_store",
    });
    const payload = await client.tool.readDispatchRequestPayload({
      jobId: "job/2",
    });
    const renewed = await client.tool.renewDispatchRequestLease({
      jobId: "job/2",
      leaseSeconds: 600,
    });
    const expired = await client.tool.expireDispatchRequests({
      queuedTimeoutSeconds: 86400,
      runningTimeoutSeconds: 3600,
      limit: 10,
    });
    const completed = await client.tool.completeDispatchRequest({
      jobId: "job/2",
      response: {
        ok: true,
        status: 202,
        bodyBytes: 12,
        truncated: false,
        schemaValidation: { status: "passed" },
      },
    });
    const failed = await client.tool.failDispatchRequest({
      jobId: "job/3",
      errorCode: "worker_failed",
    });
    const cancelled = await client.tool.cancelDispatchRequest({
      jobId: "job/4",
      reasonCode: "operator_cancelled",
    });

    expect(connector.enabled).toBe(true);
    expect(operation.enabled).toBe(true);
    expect(authed.authConfig).toMatchObject({
      apiKeyIn: "query",
      apiKeyName: "api_key",
    });
    expect(check.available).toBe(true);
    expect(dispatch.job.status).toBe("completed");
    expect(queued.job.status).toBe("queued");
    expect(queued.request.payloadStorage).toBe(
      "external_worker_secret_store_required",
    );
    expect(queued.idempotency).toEqual({ replayed: false });
    expect(claimed).toMatchObject({
      claimed: true,
      job: { id: "job_2", status: "running" },
      lease: { workerId: "svc_worker", leaseSeconds: 300 },
    });
    expect(payload.payload).toMatchObject({
      parameters: { issueId: "ISSUE-1" },
      body: { title: "Write it" },
      auth: { type: "bearer", secretRef: "env://TOOL_API_KEY" },
    });
    expect(renewed).toMatchObject({
      claimed: true,
      job: { id: "job_2", status: "running" },
      lease: { workerId: "svc_worker", leaseSeconds: 600 },
    });
    expect(expired).toMatchObject({
      expired: 1,
      jobs: [{ reasonCode: "queued_timeout" }],
    });
    expect(completed.outcome).toBe("completed");
    expect(failed.errorCode).toBe("worker_failed");
    expect(cancelled.outcome).toBe("cancelled");
    expect(cancelled.errorCode).toBe("worker_cancelled");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/tool-connectors/connector%2F1",
    );
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ enabled: true }));
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/tool-connectors/connector%2F1/operations/list%2Fissues",
    );
    expect(calls[1]?.init?.method).toBe("PATCH");
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ enabled: true }));
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/tool-connectors/connector%2F1/auth",
    );
    expect(calls[2]?.init?.method).toBe("PATCH");
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({
        type: "api_key",
        secretRef: "env://TOOL_API_KEY",
        apiKeyIn: "query",
        apiKeyName: "api_key",
      }),
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/tool-connectors/connector%2F1/auth/check",
    );
    expect(calls[3]?.init?.method).toBe("POST");
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/tool-connectors/connector%2F1/operations/list%2Fissues/dispatch",
    );
    expect(calls[4]?.init?.method).toBe("POST");
    expect(calls[4]?.init?.body).toBe(
      JSON.stringify({
        approved: true,
        approvalRequestId: "job_approval",
        parameters: { issueId: "ISSUE-1" },
      }),
    );
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/tool-connectors/connector%2F1/operations/list%2Fissues/dispatch-requests",
    );
    expect(calls[5]?.init?.method).toBe("POST");
    expect(calls[5]?.init?.body).toBe(
      JSON.stringify({
        approved: true,
        approvalRequestId: "job_approval",
        idempotencyKey: "dispatch-key-1",
        parameters: { issueId: "ISSUE-1" },
        body: { title: "Write it" },
      }),
    );
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/tool-operation-dispatch-requests/claim",
    );
    expect(calls[6]?.init?.method).toBe("POST");
    expect(calls[6]?.init?.body).toBe(
      JSON.stringify({
        leaseSeconds: 300,
        payloadStorage: "managed_encrypted_object_store",
      }),
    );
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/tool-operation-dispatch-requests/job%2F2/payload",
    );
    expect(calls[7]?.init?.method).toBe("POST");
    expect(calls[8]?.url).toBe(
      "https://romeo.example/api/v1/tool-operation-dispatch-requests/job%2F2/renew-lease",
    );
    expect(calls[8]?.init?.method).toBe("POST");
    expect(calls[8]?.init?.body).toBe(JSON.stringify({ leaseSeconds: 600 }));
    expect(calls[9]?.url).toBe(
      "https://romeo.example/api/v1/tool-operation-dispatch-requests/expire",
    );
    expect(calls[9]?.init?.method).toBe("POST");
    expect(calls[9]?.init?.body).toBe(
      JSON.stringify({
        queuedTimeoutSeconds: 86400,
        runningTimeoutSeconds: 3600,
        limit: 10,
      }),
    );
    expect(calls[10]?.url).toBe(
      "https://romeo.example/api/v1/tool-operation-dispatch-requests/job%2F2/complete",
    );
    expect(calls[10]?.init?.method).toBe("POST");
    expect(calls[10]?.init?.body).toBe(
      JSON.stringify({
        response: {
          ok: true,
          status: 202,
          bodyBytes: 12,
          truncated: false,
          schemaValidation: { status: "passed" },
        },
      }),
    );
    expect(calls[11]?.url).toBe(
      "https://romeo.example/api/v1/tool-operation-dispatch-requests/job%2F3/fail",
    );
    expect(calls[11]?.init?.method).toBe("POST");
    expect(calls[11]?.init?.body).toBe(
      JSON.stringify({ errorCode: "worker_failed" }),
    );
    expect(calls[12]?.url).toBe(
      "https://romeo.example/api/v1/tool-operation-dispatch-requests/job%2F4/cancel",
    );
    expect(calls[12]?.init?.method).toBe("POST");
    expect(calls[12]?.init?.body).toBe(
      JSON.stringify({ reasonCode: "operator_cancelled" }),
    );
  });

  it("sends OAuth client-credentials connector auth metadata through the tool resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            id: "connector_1",
            authConfig: {
              type: "oauth2_client_credentials",
              oauthTokenUrl: "https://auth.example.com/oauth/token",
            },
          },
        });
      },
    });

    await client.tool.updateConnectorAuth({
      connectorId: "connector/1",
      type: "oauth2_client_credentials",
      secretRef: "env://TOOL_OAUTH_CLIENT",
      oauthTokenUrl: "https://auth.example.com/oauth/token",
      oauthScopes: ["issues:read"],
      oauthClientAuthMethod: "client_secret_post",
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/tool-connectors/connector%2F1/auth",
    );
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        type: "oauth2_client_credentials",
        secretRef: "env://TOOL_OAUTH_CLIENT",
        oauthTokenUrl: "https://auth.example.com/oauth/token",
        oauthScopes: ["issues:read"],
        oauthClientAuthMethod: "client_secret_post",
      }),
    );
  });

  it("executes approved tools with approval request IDs through the tool resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { timeZone: "UTC" } });
      },
    });

    await client.tool.execute({
      toolId: "tool/datetime",
      agentId: "agent_1",
      payload: { timeZone: "UTC" },
      approved: true,
      approvalRequestId: "tool_call_approval",
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/tools/tool%2Fdatetime/execute",
    );
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        agentId: "agent_1",
        approved: true,
        approvalRequestId: "tool_call_approval",
        input: { timeZone: "UTC" },
      }),
    );
  });

  it("lists pending tool approvals through the tool resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: [] });
      },
    });

    await client.tool.approvals({ agentId: "agent/1", runId: "run/1" });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/tool-approvals?agentId=agent%2F1&runId=run%2F1",
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("rejects pending tool approvals through the tool resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            agentId: "agent_1",
            approvalRequestId: "tool_call/approval",
            rejectedAt: "2026-07-01T00:00:00.000Z",
            status: "rejected",
            toolId: "tool_datetime",
            workspaceId: "workspace_1",
          },
        });
      },
    });

    await client.tool.rejectApproval("tool_call/approval");

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/tool-approvals/tool_call%2Fapproval/reject",
    );
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("approves and cancels pending tool approvals through the tool resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            approvalRequestId: "tool_call/approval",
            decidedAt: "2026-07-01T00:00:00.000Z",
            status: "approved",
            toolId: "tool_datetime",
          },
        });
      },
    });

    await client.tool.approveApproval("tool_call/approval");
    await client.tool.cancelApproval("tool_call/approval");

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/tool-approvals/tool_call%2Fapproval/approve",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/tool-approvals/tool_call%2Fapproval/cancel",
    );
    expect(calls[1]?.init?.method).toBe("POST");
  });

  it("executes run-scoped model tool calls through the tool resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { result: 10 } });
      },
    });

    await client.tool.executeForRun({
      runId: "run_1",
      toolId: "tool/datetime",
      payload: { timeZone: "UTC" },
      modelToolCallId: "provider-call-1",
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/runs/run_1/tools/tool%2Fdatetime/execute",
    );
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        modelToolCallId: "provider-call-1",
        input: { timeZone: "UTC" },
      }),
    );
  });

  it("generates message speech through the voice resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            id: "speech_1",
            contentType: "audio/wav",
            playbackUrl: "/api/v1/voice-artifacts/speech_1",
            deleteUrl: "/api/v1/voice-artifacts/speech_1",
            redaction: { rawStorageKeyReturned: false },
          },
        });
      },
    });

    const speech = await client.voice.messageSpeech({
      messageId: "message/1",
      voiceProfileId: "voice_1",
    });

    expect(speech.contentType).toBe("audio/wav");
    expect(speech.playbackUrl).toBe("/api/v1/voice-artifacts/speech_1");
    expect(speech.deleteUrl).toBe("/api/v1/voice-artifacts/speech_1");
    expect(speech.redaction.rawStorageKeyReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/messages/message%2F1/speech",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ voiceProfileId: "voice_1" }),
    );
  });

  it("deletes generated voice artifacts through the voice resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            artifactId: "speech_1",
            deleted: true,
            deletedAt: "2026-07-03T00:00:00.000Z",
            storageKeyHash: "a".repeat(64),
            redaction: { rawStorageKeyReturned: false },
          },
        });
      },
    });

    const deleted = await client.voice.deleteArtifact("speech/1");

    expect(deleted.deleted).toBe(true);
    expect(deleted.redaction.rawStorageKeyReturned).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/voice-artifacts/speech%2F1",
    );
    expect(calls[0]?.init?.method).toBe("DELETE");
  });

  it("syncs voice catalogs through the voice resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            imported: 1,
            existing: 0,
            providerVoiceCount: 1,
            profiles: [{ id: "voice_1" }],
          },
        });
      },
    });

    const result = await client.voice.sync();

    expect(result.imported).toBe(1);
    expect(calls[0]?.url).toBe("https://romeo.example/api/v1/voices/sync");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("transcribes audio through the voice resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: { text: "Transcribed Romeo audio.", language: "en" },
        });
      },
    });

    const result = await client.voice.transcribe({
      audioBase64: "AQID",
      contentType: "audio/wav",
      fileName: "sample.wav",
      language: "en",
      prompt: "Vocabulary hint",
    });

    expect(result.text).toContain("Romeo");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/voice/transcriptions",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        audioBase64: "AQID",
        contentType: "audio/wav",
        fileName: "sample.wav",
        language: "en",
        prompt: "Vocabulary hint",
      }),
    );
  });

  it("manages knowledge source upload completion, extraction, embedding, and deletion paths", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({ data: { id: "kb_source_1", status: "indexed" } });
      },
    });

    await client.knowledge.completeUpload("kb/1", "source/1");
    await client.knowledge.extractUpload("kb/1", "source/1");
    await client.knowledge.indexEmbeddings({
      knowledgeBaseId: "kb/1",
      providerId: "provider/1",
      model: "text-embedding-3-small",
      batchSize: 8,
    });
    await client.knowledge.deleteSource("kb/1", "source/1");

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/knowledge-bases/kb%2F1/sources/source%2F1/complete",
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/knowledge-bases/kb%2F1/sources/source%2F1/extract",
    );
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/knowledge-bases/kb%2F1/embeddings",
    );
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({
        providerId: "provider/1",
        model: "text-embedding-3-small",
        batchSize: 8,
      }),
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/knowledge-bases/kb%2F1/sources/source%2F1",
    );
    expect(calls[3]?.init?.method).toBe("DELETE");
  });

  it("creates and runs workflows through the workflow resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: { id: "workflow_1", status: "waiting_approval" },
        });
      },
    });

    await client.workflows.templates();
    await client.workflows.createFromTemplate("agent/template", {
      workspaceId: "workspace_1",
      agentId: "agent_1",
      name: "Templated review flow",
    });
    await client.workflows.create({
      workspaceId: "workspace_1",
      name: "Review flow",
      steps: [
        {
          type: "agent_run",
          name: "Draft",
          agentId: "agent_1",
          retryPolicy: { maxAttempts: 2 },
          recoveryPolicy: { onFailure: "continue" },
        },
        {
          type: "agent_handoff",
          name: "Review",
          agentId: "agent_2",
          handoffFromStepId: "step_1",
          handoffPrompt: "Review the draft.",
          retryPolicy: { maxAttempts: 2 },
          recoveryPolicy: { onFailure: "continue" },
        },
        {
          type: "agent_room",
          name: "Discuss",
          agentIds: ["agent_1", "agent_2"],
          roomPrompt: "Discuss the draft.",
          recoveryPolicy: { onFailure: "continue" },
        },
        {
          type: "tool_approval",
          name: "Approve update",
          toolChainName: "ticket_update",
          riskLevel: "high",
          inputKeys: ["ticketId"],
        },
        {
          type: "browser_task",
          name: "Inspect",
          targetUrl: "https://example.com/releases",
          task: "Inspect the page.",
        },
        { type: "approval", name: "Review" },
        {
          type: "notification",
          name: "Notify",
          condition: { inputKey: "route", equals: "send" },
        },
      ],
      schedule: { intervalMinutes: 15, nextRunAt: "2026-01-01T00:00:00.000Z" },
    });
    await client.workflows.runDueSchedules();
    await client.workflows.startRun("workflow/1", {
      input: { requestId: "req_1" },
    });
    await client.workflows.resumeRun("workflow_run/1");
    await client.workflows.approveRun("workflow_run/1", {
      comment: "Approved",
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/workflow-templates",
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/workflow-templates/agent%2Ftemplate/create",
    );
    expect(calls[1]?.init?.body).toBe(
      JSON.stringify({
        workspaceId: "workspace_1",
        agentId: "agent_1",
        name: "Templated review flow",
      }),
    );
    expect(calls[2]?.url).toBe("https://romeo.example/api/v1/workflows");
    expect(calls[2]?.init?.body).toContain("schedule");
    expect(calls[2]?.init?.body).toContain("condition");
    expect(calls[2]?.init?.body).toContain("agent_handoff");
    expect(calls[2]?.init?.body).toContain("agent_room");
    expect(calls[2]?.init?.body).toContain("tool_approval");
    expect(calls[2]?.init?.body).toContain("browser_task");
    expect(calls[2]?.init?.body).toContain("retryPolicy");
    expect(calls[2]?.init?.body).toContain("recoveryPolicy");
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/workflows/schedules/run-due",
    );
    expect(calls[3]?.init?.method).toBe("POST");
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/workflows/workflow%2F1/runs",
    );
    expect(calls[4]?.init?.body).toBe(
      JSON.stringify({ input: { requestId: "req_1" } }),
    );
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/workflow-runs/workflow_run%2F1/resume",
    );
    expect(calls[5]?.init?.method).toBe("POST");
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/workflow-runs/workflow_run%2F1/approve",
    );
    expect(calls[6]?.init?.body).toBe(JSON.stringify({ comment: "Approved" }));
  });

  it("sends browser automation worker requests through the workflow resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: { claimed: false, workerQueue: "browser_automation" },
        });
      },
    });

    await client.workflows.claimBrowserTask({ leaseSeconds: 120 });
    await client.workflows.renewBrowserTaskLease({
      jobId: "job/browser",
      leaseSeconds: 180,
    });
    await client.workflows.createBrowserTaskArtifactUpload({
      jobId: "job/browser",
      type: "screenshot",
      contentType: "image/png",
      sizeBytes: 128,
    });
    await client.workflows.completeBrowserTask({
      jobId: "job/browser",
      result: {
        artifactCount: 1,
        capturedBytes: 4096,
        finalOrigin: "https://example.com/releases",
        navigationCount: 2,
        networkDeniedCount: 1,
        outputKeys: ["releaseStatus"],
        redactionApplied: true,
      },
    });
    await client.workflows.failBrowserTask({
      jobId: "job/browser",
      errorCode: "browser_failed",
    });
    await client.workflows.expireBrowserTasks({
      queuedTimeoutSeconds: 86_400,
      runningTimeoutSeconds: 3_600,
      limit: 10,
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/browser-automation-tasks/claim",
    );
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ leaseSeconds: 120 }));
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/browser-automation-tasks/job%2Fbrowser/renew-lease",
    );
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ leaseSeconds: 180 }));
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/browser-automation-tasks/job%2Fbrowser/artifacts/uploads",
    );
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({
        type: "screenshot",
        contentType: "image/png",
        sizeBytes: 128,
      }),
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/browser-automation-tasks/job%2Fbrowser/complete",
    );
    expect(calls[3]?.init?.body).toBe(
      JSON.stringify({
        result: {
          artifactCount: 1,
          capturedBytes: 4096,
          finalOrigin: "https://example.com/releases",
          navigationCount: 2,
          networkDeniedCount: 1,
          outputKeys: ["releaseStatus"],
          redactionApplied: true,
        },
      }),
    );
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/browser-automation-tasks/job%2Fbrowser/fail",
    );
    expect(calls[4]?.init?.body).toBe(
      JSON.stringify({ errorCode: "browser_failed" }),
    );
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/browser-automation-tasks/expire",
    );
    expect(calls[5]?.init?.body).toBe(
      JSON.stringify({
        queuedTimeoutSeconds: 86_400,
        runningTimeoutSeconds: 3_600,
        limit: 10,
      }),
    );
  });

  it("throws RomeoApiError for API error envelopes", async () => {
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async () =>
        jsonResponse(
          {
            error: {
              code: "quota_exceeded",
              message: "Quota exceeded.",
              request_id: "req_1",
              details: { metric: "run.started" },
            },
          },
          429,
        ),
    });

    await expect(client.system.health()).rejects.toMatchObject({
      name: "RomeoApiError",
      status: 429,
      message: "Quota exceeded.",
    });
  });

  it("streams typed run events through the chat resource", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            "event: message\n" +
              'data: {"id":"evt_1","runId":"run_1","sequence":1,"type":"run.completed","data":{},"createdAt":"2026-06-27T00:00:00.000Z"}\n\n',
          ),
        );
        controller.close();
      },
    });
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    const events = [];
    for await (const event of client.chatApi.events("run_1"))
      events.push(event);

    expect(events).toEqual([
      {
        id: "evt_1",
        runId: "run_1",
        sequence: 1,
        type: "run.completed",
        data: {},
        createdAt: "2026-06-27T00:00:00.000Z",
      },
    ]);
    expect(calls[0]?.init?.headers).toMatchObject({
      accept: "text/event-stream",
    });
  });

  it("creates chat comments through the chat resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: {
            id: "chat_comment_1",
            body: "Review @user_dev_admin",
            mentionedUserIds: ["user_dev_admin"],
          },
        });
      },
    });

    const comment = await client.chatApi.comment("chat/1", {
      body: "Review @user_dev_admin",
    });

    expect(comment.id).toBe("chat_comment_1");
    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/chats/chat%2F1/comments",
    );
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ body: "Review @user_dev_admin" }),
    );
  });

  it("marks notifications read through the notification resource", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        return jsonResponse({
          data: { id: "notification_1", readAt: "2026-06-27T00:00:00.000Z" },
        });
      },
    });

    await client.notifications.markRead("notification/1");
    await client.notifications.channels();
    await client.notifications.createChannel({
      type: "webhook",
      name: "Mentions",
      config: {
        url: "https://hooks.example.com/romeo",
        enabledNotificationTypes: ["chat_mention"],
      },
    });
    await client.notifications.createChannel({
      type: "email",
      name: "Email",
      config: { to: "target@example.com" },
    });
    await client.notifications.createChannel({
      type: "mobile_push",
      name: "Mobile",
      config: {
        tokenRef: "romeo-secret://secret_device_token",
        platform: "ios",
        collapseKey: "mention",
      },
    });
    await client.notifications.createChannel({
      type: "slack",
      name: "Slack",
      config: { url: "https://hooks.slack.com/services/T/B/C" },
    });
    await client.notifications.createChannel({
      type: "teams",
      name: "Teams",
      config: { url: "https://teams.example.com/webhook" },
    });
    await client.notifications.createChannel({
      type: "pagerduty",
      name: "PagerDuty",
      config: {
        routingKeyRef: "vault://romeo/pagerduty-routing-key",
        severity: "warning",
      },
    });
    await client.notifications.deliveries();
    await client.notifications.retryDue();
    await client.notifications.policy();
    await client.notifications.updatePolicy({
      allowedWebhookHosts: ["hooks.example.com"],
      allowedTeamsHosts: ["teams.example.com"],
      allowedEmailDomains: ["example.com"],
    });

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/notifications/notification%2F1/read",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/notification-channels",
    );
    expect(calls[2]?.url).toBe(
      "https://romeo.example/api/v1/notification-channels",
    );
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({
        type: "webhook",
        name: "Mentions",
        config: {
          url: "https://hooks.example.com/romeo",
          enabledNotificationTypes: ["chat_mention"],
        },
      }),
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/notification-channels",
    );
    expect(calls[3]?.init?.body).toBe(
      JSON.stringify({
        type: "email",
        name: "Email",
        config: { to: "target@example.com" },
      }),
    );
    expect(calls[4]?.url).toBe(
      "https://romeo.example/api/v1/notification-channels",
    );
    expect(calls[4]?.init?.body).toBe(
      JSON.stringify({
        type: "mobile_push",
        name: "Mobile",
        config: {
          tokenRef: "romeo-secret://secret_device_token",
          platform: "ios",
          collapseKey: "mention",
        },
      }),
    );
    expect(calls[5]?.url).toBe(
      "https://romeo.example/api/v1/notification-channels",
    );
    expect(calls[5]?.init?.body).toBe(
      JSON.stringify({
        type: "slack",
        name: "Slack",
        config: { url: "https://hooks.slack.com/services/T/B/C" },
      }),
    );
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/notification-channels",
    );
    expect(calls[6]?.init?.body).toBe(
      JSON.stringify({
        type: "teams",
        name: "Teams",
        config: { url: "https://teams.example.com/webhook" },
      }),
    );
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/notification-channels",
    );
    expect(calls[7]?.init?.body).toBe(
      JSON.stringify({
        type: "pagerduty",
        name: "PagerDuty",
        config: {
          routingKeyRef: "vault://romeo/pagerduty-routing-key",
          severity: "warning",
        },
      }),
    );
    expect(calls[8]?.url).toBe(
      "https://romeo.example/api/v1/notification-deliveries",
    );
    expect(calls[9]?.url).toBe(
      "https://romeo.example/api/v1/notification-deliveries/retry-due",
    );
    expect(calls[9]?.init?.method).toBe("POST");
    expect(calls[10]?.url).toBe(
      "https://romeo.example/api/v1/admin/notification-policy",
    );
    expect(calls[10]?.init?.method).toBe("GET");
    expect(calls[11]?.url).toBe(
      "https://romeo.example/api/v1/admin/notification-policy",
    );
    expect(calls[11]?.init?.method).toBe("PATCH");
    expect(calls[11]?.init?.body).toBe(
      JSON.stringify({
        allowedWebhookHosts: ["hooks.example.com"],
        allowedTeamsHosts: ["teams.example.com"],
        allowedEmailDomains: ["example.com"],
      }),
    );
  });

  it("calls raw SCIM v2 resources without Romeo data envelopes", async () => {
    const calls: FetchCall[] = [];
    const client = new RomeoApiClient({
      baseUrl: "https://romeo.example",
      fetchImpl: async (input, init) => {
        pushCall(calls, input, init);
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        return jsonResponse(
          String(input).includes("/Users")
            ? {
                schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
                id: "user_scim",
                userName: "scim@example.com",
              }
            : {
                schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
                totalResults: 0,
                startIndex: 1,
                itemsPerPage: 0,
                Resources: [],
              },
        );
      },
    });

    await client.scim.serviceProviderConfig();
    await client.scim.users({ filter: 'userName eq "scim@example.com"' });
    await client.scim.createUser({ userName: "scim@example.com" });
    await client.scim.patchUser("user/scim", {
      Operations: [{ op: "replace", path: "active", value: false }],
    });
    await client.scim.deleteUser("user/scim");
    await client.scim.groups();
    await client.scim.patchGroup("group/scim", {
      Operations: [{ op: "remove", path: 'members[value eq "user_scim"]' }],
    });
    await client.scim.deleteGroup("group/scim");

    expect(calls[0]?.url).toBe(
      "https://romeo.example/api/v1/scim/v2/ServiceProviderConfig",
    );
    expect(calls[1]?.url).toBe(
      "https://romeo.example/api/v1/scim/v2/Users?filter=userName+eq+%22scim%40example.com%22",
    );
    expect(calls[2]?.url).toBe("https://romeo.example/api/v1/scim/v2/Users");
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[2]?.init?.body).toBe(
      JSON.stringify({ userName: "scim@example.com" }),
    );
    expect(calls[3]?.url).toBe(
      "https://romeo.example/api/v1/scim/v2/Users/user%2Fscim",
    );
    expect(calls[3]?.init?.method).toBe("PATCH");
    expect(calls[4]?.init?.method).toBe("DELETE");
    expect(calls[5]?.url).toBe("https://romeo.example/api/v1/scim/v2/Groups");
    expect(calls[6]?.url).toBe(
      "https://romeo.example/api/v1/scim/v2/Groups/group%2Fscim",
    );
    expect(calls[7]?.url).toBe(
      "https://romeo.example/api/v1/scim/v2/Groups/group%2Fscim",
    );
    expect(calls[7]?.init?.method).toBe("DELETE");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(
  events: Array<{ event: string; data: unknown; id?: string }>,
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(
              `event: ${event.event}\nid: ${event.id ?? "event_1"}\ndata: ${JSON.stringify(event.data)}\n\n`,
            ),
          );
        }
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function pushCall(
  calls: FetchCall[],
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): void {
  const call: FetchCall = { url: String(input) };
  if (init !== undefined) call.init = init;
  calls.push(call);
}
