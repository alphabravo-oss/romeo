import { hasGrant, type AuthSubject } from "@romeo/auth";
import type { ProviderToolDefinition } from "@romeo/providers";
import { listBuiltInTools, type ToolDefinition } from "@romeo/tools";
import { z } from "zod";

import type { RomeoRepository } from "../domain/repository";
import { buildToolOperationTestPreview } from "./tool-operation-test";
import { buildOperationProviderToolDefinition } from "./tool-operation-tooling";

const providerTools = listBuiltInTools();

export async function buildProviderToolDefinitions(
  repository: RomeoRepository,
  subject: AuthSubject,
  agentId: string,
  options: { externalOperationExecutionEnabled?: boolean } = {},
): Promise<ProviderToolDefinition[]> {
  if (!subject.scopes.includes("tools:use")) return [];

  const [bindings, grants, connectors] = await Promise.all([
    repository.listAgentToolBindings(agentId),
    repository.listResourceGrants(subject.orgId),
    repository.listToolConnectors(subject.orgId),
  ]);
  const enabledToolIds = new Set(
    bindings
      .filter((binding) => binding.enabled)
      .map((binding) => binding.toolId),
  );

  const builtInDefinitions = providerTools
    .filter(
      (tool) =>
        enabledToolIds.has(tool.id) &&
        hasGrant(subject, grants, "tool", tool.id, "use"),
    )
    .map(toProviderToolDefinition);
  const operationDefinitions: ProviderToolDefinition[] = [];
  for (const connector of connectors) {
    const operations = await repository.listToolOperations(connector.id);
    for (const operation of operations) {
      if (!enabledToolIds.has(operation.id)) continue;
      const preview = buildToolOperationTestPreview(
        connector,
        operation,
        {},
        {
          externalExecutionEnabled:
            options.externalOperationExecutionEnabled === true,
        },
      );
      if (!preview.readyForExecution) continue;
      operationDefinitions.push(
        buildOperationProviderToolDefinition(connector, operation),
      );
    }
  }

  return [...builtInDefinitions, ...operationDefinitions];
}

function toProviderToolDefinition(
  tool: ToolDefinition,
): ProviderToolDefinition {
  return {
    name: tool.id,
    description: tool.description,
    parameters: zodToProviderParameters(tool.inputSchema),
  };
}

function zodToProviderParameters(
  inputSchema: ToolDefinition["inputSchema"],
): Record<string, unknown> {
  const { $schema: _schema, ...parameters } = z.toJSONSchema(
    inputSchema,
  ) as Record<string, unknown>;
  return parameters;
}
