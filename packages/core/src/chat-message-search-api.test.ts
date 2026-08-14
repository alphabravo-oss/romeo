import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

describe("chat message search API", () => {
  it("requires authentication and validates a bounded current-chat query", async () => {
    const unauthorized = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv({ DEV_SEEDED_LOGIN: "false" }),
    });
    expect(
      (
        await unauthorized.request(
          "/api/v1/chats/chat_welcome/messages/search?q=welcome",
        )
      ).status,
    ).toBe(401);

    const repository = new InMemoryRomeoRepository();
    await repository.createMessage({
      chatId: "chat_welcome",
      content: "Current chat search sentinel",
      createdAt: "2026-08-14T12:00:00.000Z",
      id: "message_search_api",
      role: "user",
    });
    const api = createRomeoApi(repository, {
      env: testEnv({ DEV_SEEDED_LOGIN: "true" }),
    });
    expect(
      (await api.request("/api/v1/chats/chat_welcome/messages/search?q=x"))
        .status,
    ).toBe(400);
    const response = await api.request(
      "/api/v1/chats/chat_welcome/messages/search?q=SEARCH%20SENTINEL&limit=1",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          branch: "active",
          branchLeafMessageId: "message_search_api",
          messageId: "message_search_api",
          snippet: "Current chat search sentinel",
        },
      ],
      meta: {
        hasMore: false,
        limit: 1,
        total: 1,
        transcriptVersion: "1",
      },
    });
  });
});
