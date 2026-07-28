import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import { listBuiltInTools, type ToolDefinition } from "@romeo/tools";

import type { Agent, AgentToolBinding } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { createOperationToolDefinition } from "./tool-operation-tooling";
import {
  toAgentToolSummary,
  toToolSummary,
  type AgentToolSummary,
  type ToolSummary,
} from "./tool-execution";
import type { OperationToolContext } from "./tool-service-contracts";

export class ToolCatalogService {
  private readonly tools = new Map<string, ToolDefinition>(
    listBuiltInTools().map((tool) => [tool.id, tool]),
  );

  constructor(private readonly repository: RomeoRepository) {}

  list(subject: AuthSubject): ToolSummary[] {
    assertScope(subject, "tools:use");
    return [...this.tools.values()].map(toToolSummary);
  }

  async listForAgent(
    subject: AuthSubject,
    agentId: string,
  ): Promise<AgentToolSummary[]> {
    assertScope(subject, "tools:use");
    const agent = await this.getAgentForSubject(subject, agentId);
    const [bindings, grants, operationTools] = await Promise.all([
      this.repository.listAgentToolBindings(agent.id),
      this.repository.listResourceGrants(subject.orgId),
      this.listOperationTools(subject),
    ]);
    const builtInSummaries = [...this.tools.values()].map((tool) =>
      toAgentToolSummary(
        tool,
        agent,
        bindings.find((binding) => binding.toolId === tool.id),
        hasGrant(subject, grants, "tool", tool.id, "use"),
      ),
    );
    return [
      ...builtInSummaries,
      ...operationTools.map((item) =>
        toAgentToolSummary(
          item.tool,
          agent,
          bindings.find((binding) => binding.toolId === item.tool.id),
          true,
        ),
      ),
    ];
  }

  async updateBinding(input: {
    subject: AuthSubject;
    agentId: string;
    toolId: string;
    enabled?: boolean;
    approvalRequired?: boolean;
  }): Promise<AgentToolSummary> {
    assertScope(input.subject, "agents:write");
    assertScope(input.subject, "tools:manage");
    const operationTool = await this.getOperationTool(
      input.subject,
      input.toolId,
    );
    const tool = operationTool?.tool ?? this.getBuiltIn(input.toolId);
    const agent = await this.getAgentForSubject(input.subject, input.agentId);
    if (operationTool === undefined)
      await this.assertToolAccess(input.subject, tool.id);
    const existing = await this.getBinding(agent.id, tool.id);
    const now = new Date().toISOString();
    const binding = await this.repository.transaction(async (repository) => {
      const saved = await repository.upsertAgentToolBinding({
        id: existing?.id ?? createId("agent_tool_binding"),
        orgId: agent.orgId,
        agentId: agent.id,
        toolId: tool.id,
        enabled: input.enabled ?? existing?.enabled ?? true,
        approvalRequired:
          input.approvalRequired ??
          existing?.approvalRequired ??
          tool.approvalPolicy === "always",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "agent.tool_binding.update",
        resourceType: "agent",
        resourceId: agent.id,
        metadata: {
          toolId: tool.id,
          enabled: saved.enabled,
          approvalRequired: saved.approvalRequired,
          created: existing === undefined,
          importedOperation: operationTool !== undefined,
        },
      });
      return saved;
    });
    return toAgentToolSummary(tool, agent, binding, true);
  }

  getBuiltIn(toolId: string): ToolDefinition {
    const tool = this.tools.get(toolId);
    if (!tool) throw notFound("Tool");
    return tool;
  }

  findBuiltIn(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  async getOperationTool(
    subject: AuthSubject,
    toolId: string,
  ): Promise<OperationToolContext | undefined> {
    return (await this.listOperationTools(subject)).find(
      (item) => item.operation.id === toolId,
    );
  }

  async listOperationTools(
    subject: AuthSubject,
  ): Promise<OperationToolContext[]> {
    const connectors = await this.repository.listToolConnectors(subject.orgId);
    const operationGroups = await Promise.all(
      connectors.map(async (connector) => ({
        connector,
        operations: await this.repository.listToolOperations(connector.id),
      })),
    );
    return operationGroups.flatMap(({ connector, operations }) =>
      operations.map((operation) => ({
        connector,
        operation,
        tool: createOperationToolDefinition(connector, operation),
      })),
    );
  }

  async getBinding(
    agentId: string,
    toolId: string,
  ): Promise<AgentToolBinding | undefined> {
    return (await this.repository.listAgentToolBindings(agentId)).find(
      (binding) => binding.toolId === toolId,
    );
  }

  async getAgentForSubject(
    subject: AuthSubject,
    agentId: string,
  ): Promise<Agent> {
    const agent = await this.repository.getAgent(agentId);
    if (!agent) throw notFound("Agent");
    if (!canAccessOrg(subject, agent.orgId))
      throw new AuthorizationError(
        "The agent is outside the caller organization.",
      );
    if (!hasWorkspaceAccess(subject, agent.workspaceId))
      throw new AuthorizationError(
        "The agent is outside the caller workspace access.",
      );
    return agent;
  }

  async assertToolAccess(subject: AuthSubject, toolId: string): Promise<void> {
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (!hasGrant(subject, grants, "tool", toolId, "use"))
      throw new AuthorizationError(`Missing use permission for tool:${toolId}`);
  }
}
