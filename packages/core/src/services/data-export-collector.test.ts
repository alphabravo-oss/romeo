import { seededSubject } from "@romeo/auth";
import { describe, expect, it, vi } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { collectDataExport } from "./data-export-collector";

describe("data export collector query bounds", () => {
  it("skips embedding payloads for previews", async () => {
    const repository = new InMemoryRomeoRepository();
    const listEmbeddings = vi.spyOn(repository, "listKnowledgeChunkEmbeddings");

    const result = await collectDataExport({
      repository,
      subject: seededSubject,
      request: {
        scope: "org",
        includeContent: false,
        includeObjectBytes: false,
        maxObjectBytes: 0,
      },
      includeData: false,
    });

    expect(result.counts.workspaces).toBeGreaterThan(0);
    expect(listEmbeddings).not.toHaveBeenCalled();
    expect(result.data).toEqual(
      expect.objectContaining({
        knowledgeBases: [],
        usageEvents: [],
      }),
    );
  });
});
