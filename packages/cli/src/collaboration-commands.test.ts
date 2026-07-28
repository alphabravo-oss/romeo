import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeCollaborationCommand } from "./collaboration-commands";

describe("collaboration commands", () => {
  it("routes every collaboration command through the generated SDK", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    let output = "";
    const generatedClient = Object.fromEntries(
      ["delete", "get", "patch", "post"].map((method) => [
        method,
        async (options: { url: string }) => {
          requests.push({ method, url: options.url });
          return { data: { data: [] } };
        },
      ]),
    );
    const context = {
      generatedClient: generatedClient as never,
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
    const cases: Array<{ args: string[]; method: string; url: string }> = [
      { args: ["gallery", "agents"], method: "get", url: "/agent-gallery" },
      { args: ["favorites", "list"], method: "get", url: "/favorites" },
      {
        args: ["favorites", "agent", "--agent", "agent_1"],
        method: "post",
        url: "/favorites",
      },
      {
        args: ["prompts", "list", "--workspace", "workspace_1"],
        method: "get",
        url: "/prompt-templates",
      },
      {
        args: ["prompts", "marketplace", "--workspace", "workspace_1"],
        method: "get",
        url: "/prompt-marketplace",
      },
      {
        args: [
          "prompts",
          "create",
          "--workspace",
          "workspace_1",
          "--name",
          "Review",
          "--body",
          "Review this",
        ],
        method: "post",
        url: "/prompt-templates",
      },
      {
        args: ["prompts", "update", "--prompt", "prompt_1", "--name", "New"],
        method: "patch",
        url: "/prompt-templates/{promptTemplateId}",
      },
      {
        args: ["folders", "list", "--workspace", "workspace_1"],
        method: "get",
        url: "/collaboration/folders",
      },
      {
        args: [
          "folders",
          "create",
          "--workspace",
          "workspace_1",
          "--name",
          "Work",
        ],
        method: "post",
        url: "/collaboration/folders",
      },
      {
        args: ["folders", "share", "--folder", "folder_1"],
        method: "post",
        url: "/collaboration/folders/{folderId}/shares",
      },
      {
        args: ["folders", "items", "--folder", "folder_1"],
        method: "get",
        url: "/collaboration/folders/{folderId}/items",
      },
      {
        args: [
          "folders",
          "add-item",
          "--folder",
          "folder_1",
          "--type",
          "chat",
          "--resource",
          "chat_1",
        ],
        method: "post",
        url: "/collaboration/folders/{folderId}/items",
      },
      {
        args: [
          "folders",
          "delete-item",
          "--folder",
          "folder_1",
          "--item",
          "item_1",
        ],
        method: "delete",
        url: "/collaboration/folders/{folderId}/items/{itemId}",
      },
      { args: ["share", "targets"], method: "get", url: "/share-targets" },
      {
        args: ["share", "agent", "--agent", "agent_1"],
        method: "post",
        url: "/agents/{agentId}/shares",
      },
      {
        args: ["share", "chat", "--chat", "chat_1"],
        method: "post",
        url: "/chats/{chatId}/shares",
      },
      {
        args: ["share", "kb", "--kb", "kb_1"],
        method: "post",
        url: "/knowledge-bases/{knowledgeBaseId}/shares",
      },
      {
        args: ["share", "prompt", "--prompt", "prompt_1"],
        method: "post",
        url: "/prompt-templates/{promptTemplateId}/shares",
      },
    ];

    for (const testCase of cases) {
      const [area, action] = testCase.args;
      await expect(
        executeCollaborationCommand(area!, action, {
          ...context,
          parsed: parseArgs(testCase.args),
        }),
      ).resolves.toBe(0);
    }

    expect(requests).toEqual(cases.map(({ method, url }) => ({ method, url })));
    expect(output).toContain("[]");
  });
});
