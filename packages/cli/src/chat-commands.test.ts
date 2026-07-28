import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeChatCommand } from "./chat-commands";

describe("chat commands", () => {
  it("uses the generated SDK for chat collaboration operations", async () => {
    const requests: Array<{ body?: unknown; path?: unknown; url: string }> = [];
    let output = "";
    const context = {
      generatedClient: {
        get: async (options: {
          body?: unknown;
          path?: unknown;
          url: string;
        }) => {
          requests.push(options);
          return { data: { data: [] } };
        },
        post: async (options: {
          body?: unknown;
          path?: unknown;
          url: string;
        }) => {
          requests.push(options);
          const id = options.url === "/runs" ? "run_generated" : "generated";
          return { data: { data: { id } } };
        },
        sse: {
          get: async (options: { url: string }) => {
            requests.push(options);
            return {
              stream: (async function* () {
                yield {
                  id: "event_1",
                  runId: "run_generated",
                  sequence: 1,
                  type: "message.delta",
                  data: { text: "Hello" },
                  createdAt: "2026-07-18T00:00:00.000Z",
                };
              })(),
            };
          },
        },
      } as never,
      io: {
        stdout: {
          write: (value: string) => {
            output += value;
            return true;
          },
        },
        stderr: { write: () => true },
      },
    };

    for (const args of [
      ["comments", "list", "--chat", "chat_1"],
      ["comments", "create", "--chat", "chat_1", "--body", "Review"],
      ["chat", "archive", "--chat", "chat_1"],
      ["chat", "legal-hold", "--chat", "chat_1", "--until", "2030-01-01"],
      ["chat", "legal-hold-clear", "--chat", "chat_1"],
      [
        "chat",
        "run",
        "--workspace",
        "workspace_1",
        "--agent",
        "agent_1",
        "--prompt",
        "Hello",
      ],
    ]) {
      await expect(
        executeChatCommand(args[0]!, args[1], {
          ...context,
          parsed: parseArgs(args),
        }),
      ).resolves.toBe(0);
    }

    expect(requests.map(({ url }) => url)).toEqual([
      "/chats/{chatId}/comments",
      "/chats/{chatId}/comments",
      "/chats/{chatId}/archive",
      "/chats/{chatId}/legal-hold",
      "/chats/{chatId}/legal-hold",
      "/chats",
      "/runs",
      "/runs/{runId}/events",
    ]);
    expect(output).toContain("generated");
  });
});
