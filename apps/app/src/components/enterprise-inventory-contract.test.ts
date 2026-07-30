import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const inventoryComponents = [
  "AgentAccessPanel.tsx",
  "AuthProviderSplitView.tsx",
  "EvalInventoryTables.tsx",
  "KnowledgeCatalogPage.tsx",
  "ManagedModelAdminPanel.tsx",
  "ManagedModelKnowledgePanel.tsx",
  "ManagedModelToolPanel.tsx",
  "ModelCatalogPanel.tsx",
  "PersonalContentTable.tsx",
  "ProviderModelsTable.tsx",
  "ProviderPanel.tsx",
  "ToolConnectorPanel.tsx",
  "ToolPanel.tsx",
  "VoicePanel.tsx",
] as const;

describe("enterprise resource inventories", () => {
  for (const fileName of inventoryComponents) {
    it(`${fileName} uses the shared TanStack table`, () => {
      const source = readFileSync(new URL(fileName, import.meta.url), "utf8");
      expect(source).toMatch(/\bDataTable\b/u);
    });
  }

  it("uses vertical kebabs for overflow menus", () => {
    const overflowMenu = readFileSync(
      new URL("OverflowMenu.tsx", import.meta.url),
      "utf8",
    );
    const providerPanel = readFileSync(
      new URL("ProviderPanel.tsx", import.meta.url),
      "utf8",
    );
    expect(`${overflowMenu}\n${providerPanel}`).not.toMatch(
      /more-horizontal|icons\/ellipsis\.mjs/u,
    );
    expect(`${overflowMenu}\n${providerPanel}`).toMatch(
      /more-vertical|ellipsis-vertical/u,
    );
  });
});
