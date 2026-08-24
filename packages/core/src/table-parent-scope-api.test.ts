import { defaultProviderCapabilities } from "@romeo/providers";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

describe("parent-scoped inventoried table API", () => {
  it("isolates provider models, eval suites, and tool traces across parents", async () => {
    const repository = new InMemoryRomeoRepository();
    for (const id of ["provider_api_a", "provider_api_b"]) {
      await repository.createProvider({
        baseUrl: "https://example.com/v1",
        capabilities: defaultProviderCapabilities("anthropic"),
        enabled: true,
        id,
        name: id,
        orgId: "org_default",
        type: "anthropic",
      });
    }
    await repository.upsertModels([
      model("model_api_a", "provider_api_a"),
      model("model_api_a_extra", "provider_api_a", "zeta"),
      model("model_api_b", "provider_api_b"),
    ]);
    for (const agentId of ["agent_api_a", "agent_api_b"]) {
      await repository.createEvalSuite({
        agentId,
        createdAt: "2026-08-23T12:00:00.000Z",
        createdBy: "user_dev_admin",
        id: `suite_${agentId}`,
        name: agentId,
        orgId: "org_default",
        updatedAt: "2026-08-23T12:00:00.000Z",
        workspaceId: "workspace_default",
      });
      await repository.createToolCall({
        actorId: "user_dev_admin",
        agentId,
        approvalRequired: false,
        completedAt: "2026-08-23T12:01:00.000Z",
        id: `call_${agentId}`,
        inputKeys: [],
        orgId: "org_default",
        outputKeys: [],
        riskLevel: "low",
        startedAt: "2026-08-23T12:00:00.000Z",
        status: "success",
        toolId: "tool_api",
        workspaceId: "workspace_default",
      });
    }
    await repository.createEvalSuite({
      agentId: "agent_api_a",
      createdAt: "2026-08-23T12:02:00.000Z",
      createdBy: "user_dev_admin",
      id: "suite_agent_api_a_extra",
      name: "Zeta suite",
      orgId: "org_default",
      updatedAt: "2026-08-23T12:02:00.000Z",
      workspaceId: "workspace_default",
    });
    await repository.createToolCall({
      actorId: "user_dev_admin",
      agentId: "agent_api_a",
      approvalRequired: false,
      completedAt: "2026-08-23T12:03:00.000Z",
      id: "call_agent_api_a_extra",
      inputKeys: [],
      orgId: "org_default",
      outputKeys: [],
      riskLevel: "low",
      startedAt: "2026-08-23T12:02:00.000Z",
      status: "success",
      toolId: "tool_zeta",
      workspaceId: "workspace_default",
    });
    const api = createRomeoApi(repository, {
      env: testEnv({
        SESSION_SECRET: "table-parent-scope-api-test-session-secret-v1",
      }),
      startBackgroundWorkers: false,
    });

    await expect(
      pageIds(api, "provider_models", "provider_api_a"),
    ).resolves.toEqual(["model_api_a", "model_api_a_extra"]);
    await expect(pageIds(api, "eval_suites", "agent_api_a")).resolves.toEqual([
      "suite_agent_api_a_extra",
      "suite_agent_api_a",
    ]);
    await expect(
      pageIds(api, "tool_trace_calls", "agent_api_a"),
    ).resolves.toEqual(["call_agent_api_a_extra", "call_agent_api_a"]);
    await expect(
      pageIds(api, "provider_models", "provider_api_b"),
    ).resolves.toEqual(["model_api_b"]);
    const crossProviderDelete = await api.request(
      "/api/v1/providers/provider_api_a/ollama/models/model_api_b?modelId=model_api_b",
      { method: "DELETE" },
    );
    expect(crossProviderDelete.status).toBe(404);
    const legacyCrossProviderDelete = await api.request(
      "/api/v1/providers/provider_api_a/ollama/models/model_api_b",
      { method: "DELETE" },
    );
    expect(legacyCrossProviderDelete.status).toBe(404);

    const firstProviderPage = await page(
      api,
      "provider_models",
      "provider_api_a",
      {
        limit: 1,
        sort: [{ direction: "asc", field: "name" }],
      },
    );
    expect(firstProviderPage.items.map((row) => row.id)).toEqual([
      "model_api_a",
    ]);
    const providerCursor = firstProviderPage.page.nextCursor;
    if (providerCursor === null) throw new Error("Expected a provider cursor.");
    const secondProviderPage = await page(
      api,
      "provider_models",
      "provider_api_a",
      {
        cursor: providerCursor,
        limit: 1,
        sort: [{ direction: "asc", field: "name" }],
      },
    );
    expect(secondProviderPage.items.map((row) => row.id)).toEqual([
      "model_api_a_extra",
    ]);
    expect(
      (
        await page(api, "provider_models", "provider_api_a", { search: "zeta" })
      ).items.map((row) => row.id),
    ).toEqual(["model_api_a_extra"]);

    const firstTracePage = await page(api, "tool_trace_calls", "agent_api_a", {
      limit: 1,
      sort: [{ direction: "asc", field: "toolId" }],
    });
    expect(firstTracePage.items.map((row) => row.id)).toEqual([
      "call_agent_api_a",
    ]);
    const traceCursor = firstTracePage.page.nextCursor;
    if (traceCursor === null) throw new Error("Expected a tool-trace cursor.");
    const secondTracePage = await page(api, "tool_trace_calls", "agent_api_a", {
      cursor: traceCursor,
      limit: 1,
      sort: [{ direction: "asc", field: "toolId" }],
    });
    expect(secondTracePage.items.map((row) => row.id)).toEqual([
      "call_agent_api_a_extra",
    ]);
    expect(
      (
        await page(api, "tool_trace_calls", "agent_api_a", { search: "extra" })
      ).items.map((row) => row.id),
    ).toEqual(["call_agent_api_a_extra"]);
  });
});

async function pageIds(
  api: ReturnType<typeof createRomeoApi>,
  resource: string,
  parentId: string,
): Promise<string[]> {
  return (await page(api, resource, parentId)).items.map((row) => row.id);
}

async function page(
  api: ReturnType<typeof createRomeoApi>,
  resource: string,
  parentId: string,
  input: {
    cursor?: string;
    limit?: number;
    search?: string;
    sort?: Array<{ direction: "asc" | "desc"; field: string }>;
  } = {},
): Promise<{
  items: Array<{ id: string }>;
  page: { nextCursor: string | null };
}> {
  const response = await api.request("/api/v1/admin/table-pages", {
    body: JSON.stringify({
      ...input,
      filters: [],
      limit: input.limit ?? 25,
      parentId,
      resource,
      sort: input.sort ?? [],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: {
      items: Array<{ id: string }>;
      page: { nextCursor: string | null };
    };
  };
  return body.data;
}

function model(id: string, providerId: string, name = id) {
  return {
    capabilities: defaultProviderCapabilities("anthropic"),
    contextWindow: 32_000,
    displayName: name,
    enabled: true,
    id,
    name,
    providerId,
  };
}
