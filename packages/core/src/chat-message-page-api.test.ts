import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

describe("chat message page API", () => {
  it("requires authentication and an explicit older direction", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv({ DEV_SEEDED_LOGIN: "false" }),
    });
    const unauthorized = await api.request(
      "/api/v1/chats/chat_welcome/messages/page?direction=older",
    );
    expect(unauthorized.status).toBe(401);

    const authorized = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv({ DEV_SEEDED_LOGIN: "true" }),
    });
    const missingDirection = await authorized.request(
      "/api/v1/chats/chat_welcome/messages/page",
    );
    expect(missingDirection.status).toBe(400);

    const page = await authorized.request(
      "/api/v1/chats/chat_welcome/messages/page?direction=older",
    );
    const body = await page.json();
    expect(page.status).toBe(200);
    expect(body.meta.transcriptVersion).toMatch(/^[0-9]{1,20}$/u);
    // Page validators are part of typed metadata rather than HTTP cache
    // validators: authorization and cursor scope must be evaluated per read.
    expect(page.headers.get("etag")).toBeNull();
  });
});
