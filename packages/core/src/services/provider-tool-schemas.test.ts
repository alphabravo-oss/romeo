import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { enableAgentToolBinding } from "../test-support/agent-tools";
import { buildProviderToolDefinitions } from "./provider-tool-schemas";

describe("buildProviderToolDefinitions", () => {
  it("builds JSON-schema provider tools from enabled, granted agent bindings", async () => {
    const repository = new InMemoryRomeoRepository();
    await enableAgentToolBinding(repository, "tool_calculator");
    await enableAgentToolBinding(repository, "tool_datetime");

    const tools = await buildProviderToolDefinitions(
      repository,
      toolUserSubject,
      "agent_default",
    );

    expect(tools.map((tool) => tool.name)).toEqual([
      "tool_calculator",
      "tool_datetime",
    ]);
    expect(tools[0]).toMatchObject({
      name: "tool_calculator",
      description:
        "Evaluates a constrained arithmetic expression without dynamic code execution.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", minLength: 1, maxLength: 128 },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    });
    expect(JSON.stringify(tools)).not.toContain("$schema");
  });

  it("omits tools when the subject lacks tool scope or grants", async () => {
    const repository = new InMemoryRomeoRepository();
    // Enabled so an empty result proves the scope/grant check, not that the
    // seed happens to ship these bindings disabled.
    await enableAgentToolBinding(repository, "tool_calculator");
    await enableAgentToolBinding(repository, "tool_datetime");

    await expect(
      buildProviderToolDefinitions(
        repository,
        { ...toolUserSubject, scopes: [] },
        "agent_default",
      ),
    ).resolves.toEqual([]);
    await expect(
      buildProviderToolDefinitions(
        repository,
        { ...toolUserSubject, groupIds: [] },
        "agent_default",
      ),
    ).resolves.toEqual([]);
  });

  it("omits disabled agent tool bindings", async () => {
    const repository = new InMemoryRomeoRepository();
    // Enable both first, so disabling datetime below is what removes it.
    await enableAgentToolBinding(repository, "tool_calculator");
    await enableAgentToolBinding(repository, "tool_datetime");
    const datetime = (
      await repository.listAgentToolBindings("agent_default")
    ).find((binding) => binding.toolId === "tool_datetime");
    if (datetime === undefined) throw new Error("Missing datetime binding");
    await repository.upsertAgentToolBinding({
      ...datetime,
      enabled: false,
      updatedAt: new Date().toISOString(),
    });

    const tools = await buildProviderToolDefinitions(
      repository,
      toolUserSubject,
      "agent_default",
    );

    expect(tools.map((tool) => tool.name)).toEqual(["tool_calculator"]);
  });

  it("adds agent-bound ready imported operations as provider tools", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    await repository.createToolConnector({
      id: "tool_connector_provider_schema",
      orgId: "org_default",
      type: "openapi",
      name: "Issue tracker",
      description: "",
      schema: { baseUrl: "https://api.example.com" },
      authConfig: { type: "none", configured: false },
      networkPolicy: {
        mode: "allow_hosts",
        allowedHosts: ["api.example.com"],
        allowPrivateNetwork: false,
      },
      riskLevel: "low",
      approvalPolicy: "never",
      visibility: "org",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const [operation] = await repository.createToolOperations([
      {
        id: "tool_operation_provider_schema",
        orgId: "org_default",
        connectorId: "tool_connector_provider_schema",
        operationId: "getIssue",
        method: "get",
        path: "/issues/{issueId}",
        name: "Get issue",
        description: "Get an issue by ID.",
        inputSchema: {
          parameters: [
            {
              name: "issueId",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
            {
              name: "expand",
              in: "query",
              schema: { type: "string" },
            },
          ],
          requestBody: null,
        },
        outputSchema: {},
        riskLevel: "low",
        approvalPolicy: "never",
        enabled: true,
        createdAt: now,
      },
    ]);
    await repository.upsertAgentToolBinding({
      id: "agent_tool_binding_provider_schema_operation",
      orgId: "org_default",
      agentId: "agent_default",
      toolId: operation!.id,
      enabled: true,
      approvalRequired: false,
      createdAt: now,
      updatedAt: now,
    });

    const disabledTools = await buildProviderToolDefinitions(
      repository,
      toolUserSubject,
      "agent_default",
    );
    const enabledTools = await buildProviderToolDefinitions(
      repository,
      toolUserSubject,
      "agent_default",
      { externalOperationExecutionEnabled: true },
    );

    expect(disabledTools.map((tool) => tool.name)).not.toContain(operation!.id);
    expect(enabledTools.map((tool) => tool.name)).toContain(operation!.id);
    expect(
      enabledTools.find((tool) => tool.name === operation!.id),
    ).toMatchObject({
      parameters: {
        properties: {
          parameters: {
            properties: {
              issueId: { type: "string", minLength: 1 },
              expand: { type: "string" },
            },
            required: ["issueId"],
          },
        },
        required: ["parameters"],
      },
    });
  });
});

const toolUserSubject: AuthSubject = {
  id: "user_dev_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: ["group_admins"],
  scopes: ["tools:use"],
};
