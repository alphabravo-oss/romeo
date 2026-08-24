import { seededSubject } from "@romeo/auth";
import { describe, expect, it, vi } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { collectDataExport } from "./data-export-collector";

describe("data export collector query bounds", () => {
  it("loads connector syncs once and skips embedding payloads for previews", async () => {
    const repository = new InMemoryRomeoRepository();
    const listConnectorSyncs = vi.spyOn(repository, "listDataConnectorSyncs");
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
    expect(listConnectorSyncs).toHaveBeenCalledTimes(1);
    expect(listEmbeddings).not.toHaveBeenCalled();
    expect(result.data).toEqual(
      expect.objectContaining({
        knowledgeBases: [],
        usageEvents: [],
      }),
    );
  });
});
