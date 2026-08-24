import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

describe("inventoried component data authority", () => {
  it("scopes provider rows and every row action to the row's provider", () => {
    const providerModels = source("ProviderModelsTable.tsx");
    expect(providerModels).toContain(
      'useInventoriedServerTable("provider_models", {',
    );
    expect(providerModels).toContain("parentId: provider.id");
    expect(providerModels).toMatch(/provider: row\.original\.providerId/gu);
    expect(providerModels).toContain("onDeleteModel(row.original)");
    expect(providerModels).not.toMatch(/\bmodels:\s*BaseModel\[\]/u);
  });

  it("uses the parent-scoped table as the eval-suite authority", () => {
    const panel = source("EvalPanel.tsx");
    expect(panel).toContain('"eval_suites"');
    expect(panel).toContain("{ parentId: agentId }");
    expect(panel).toContain("data={suitesTable.rows}");
    expect(panel).toContain("serverState={suitesTable.serverState}");
    expect(panel).not.toContain("evalSuitesQueryOptions");
  });

  it("applies one usage interval to rows, totals, export, and disclosure", () => {
    const panel = source("UsagePanel.tsx");
    expect(panel).toContain('operator: "gte"');
    expect(panel).toContain('operator: "lt"');
    expect(panel).toContain("usageSummaryQueryOptions(interval)");
    expect(panel).toContain("exportUsageEventsCsv(interval)");
    expect(panel).toContain('t("usageAppliedInterval")');
    expect(panel).not.toContain("usageEventsQueryOptions");
  });

  it("uses one agent-scoped query for tool-trace rows and refresh", () => {
    const panel = source("ToolTracePanel.tsx");
    expect(panel).toContain('"tool_trace_calls"');
    expect(panel).toContain("{ parentId: activeAgentId }");
    expect(panel).toContain("data={inventoriedTable.rows}");
    expect(panel).toContain("inventoriedTable.query.refetch()");
    expect(panel).not.toContain("toolCallsQueryOptions");
  });

  it("does not mix legacy list authorities into migrated inventory panels", () => {
    const prompt = source("PromptTemplatePanel.tsx");
    const tools = source("ToolConnectorPanel.tsx");
    const knowledge = source("KnowledgePanel.tsx");
    expect(prompt).not.toContain("promptTemplatesQueryOptions");
    expect(tools).not.toContain("toolConnectorsQueryOptions");
    expect(knowledge).not.toContain("knowledgeBasesQueryOptions");
    expect(knowledge).not.toContain("knowledgeSourcesQueryOptions");
    expect(prompt).toContain("summary.marketplaceTotal");
    expect(tools).toContain("summary.enabledTotal");
  });

  it("keeps admin and workspace controllers on catalog-only data", () => {
    const admin = source("useAdminController.ts");
    const workspace = readFileSync(
      new URL("../routes/workspace.tsx", import.meta.url),
      "utf8",
    );
    expect(admin).toContain("useWorkspaceCatalogData");
    expect(admin).not.toContain("useWorkspaceData(");
    expect(workspace).toContain("useWorkspaceCatalogData");
    expect(workspace).not.toContain("useWorkspaceData(");
  });
});
