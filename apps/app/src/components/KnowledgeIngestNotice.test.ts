import { describe, expect, it } from "vitest";

import { knowledgeIngestBlockedMessageKey } from "./KnowledgeIngestNotice";

describe("knowledgeIngestBlockedMessageKey", () => {
  it.each([
    ["embedding_unset", "knowledgeIngestBlockedEmbedding"],
    ["tiers_disabled", "knowledgeIngestBlockedTiers"],
    ["vector_unconfigured", "knowledgeIngestBlockedVector"],
  ] as const)("maps %s to its specific operator guidance", (reason, key) => {
    expect(knowledgeIngestBlockedMessageKey(reason)).toBe(key);
  });
});
