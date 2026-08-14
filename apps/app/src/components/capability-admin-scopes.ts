import type { CapabilityScope } from "../features/capabilities";
import type { MessageKey } from "../lib/i18n";

export interface CapabilityScopeOption {
  key: string;
  label: string;
  labelKey: MessageKey;
  scope: CapabilityScope;
}

export function buildCapabilityScopeOptions(input: {
  subjectOrgId?: string;
  organizationName?: string;
  workspaces: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string; workspaceId: string }>;
  groups?: Array<{ id: string; name: string }>;
  users?: Array<{
    id: string;
    name: string;
    email: string;
    disabledAt?: string;
  }>;
  identityWorkspaceId?: string;
}): CapabilityScopeOption[] {
  const firstWorkspace = input.workspaces[0];
  if (input.subjectOrgId === undefined || firstWorkspace === undefined)
    return [];
  const identityWorkspaceId = input.identityWorkspaceId ?? firstWorkspace.id;
  return [
    {
      key: `organization:${input.subjectOrgId}`,
      label: input.organizationName ?? input.subjectOrgId,
      labelKey: "capabilityOrganization",
      scope: {
        scopeType: "organization",
        scopeId: input.subjectOrgId,
        workspaceId: firstWorkspace.id,
      },
    },
    ...input.workspaces.map((workspace) => ({
      key: `workspace:${workspace.id}`,
      label: workspace.name,
      labelKey: "capabilityWorkspace" as const,
      scope: {
        scopeType: "workspace" as const,
        scopeId: workspace.id,
        workspaceId: workspace.id,
      },
    })),
    ...input.agents.map((agent) => ({
      key: `agent:${agent.id}`,
      label: agent.name,
      labelKey: "capabilityAgent" as const,
      scope: {
        scopeType: "agent" as const,
        scopeId: agent.id,
        workspaceId: agent.workspaceId,
      },
    })),
    ...(input.groups ?? []).map((group) => ({
      key: `group:${group.id}`,
      label: group.name,
      labelKey: "capabilityGroup" as const,
      scope: {
        scopeType: "group" as const,
        scopeId: group.id,
        workspaceId: identityWorkspaceId,
      },
    })),
    ...(input.users ?? [])
      .filter((user) => user.disabledAt === undefined)
      .map((user) => ({
        key: `user:${user.id}`,
        label: `${user.name} (${user.email})`,
        labelKey: "capabilityUser" as const,
        scope: {
          scopeType: "user" as const,
          scopeId: user.id,
          workspaceId: identityWorkspaceId,
        },
      })),
  ];
}
