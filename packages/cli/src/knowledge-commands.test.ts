import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeKnowledgeCommand } from "./knowledge-commands";

describe("knowledge commands", () => {
  it("uses the generated SDK for extraction", async () => {
    const requests: Array<{ method: string; path?: unknown; url: string }> = [];
    let output = "";
    const command = executeKnowledgeCommand("knowledge", "extract", {
      fetchImpl: fetch,
      generatedClient: {
        post: async (options: { path?: unknown; url: string }) => {
          requests.push({
            method: "POST",
            path: options.path,
            url: options.url,
          });
          return {
            data: {
              data: {
                job: { id: "job_generated_1", status: "completed" },
                source: { id: "source_generated_1", status: "indexed" },
              },
            },
          };
        },
      } as never,
      io: {
        stdout: {
          write: (value) => {
            output += value;
            return true;
          },
        },
        stderr: { write: () => true },
      },
      parsed: parseArgs([
        "knowledge",
        "extract",
        "--kb",
        "kb_1",
        "--source",
        "source_1",
      ]),
      readFile: async () => new Uint8Array(),
    });

    await expect(command).resolves.toBe(0);
    expect(requests).toEqual([
      {
        method: "POST",
        path: { knowledgeBaseId: "kb_1", sourceId: "source_1" },
        url: "/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}/extract",
      },
    ]);
    expect(output).toContain("job_generated_1");
  });
});
