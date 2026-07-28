import { AuthorizationError, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { getAuthorizedAgent } from "./agent-access";
import { writeAuditLog } from "./audit-log";
import {
  clearManagedModelPreferences,
  getManagedModelCustomizationPolicy,
  getManagedModelPreferences,
  setManagedModelCustomizationPolicy,
  setManagedModelPreferences,
  type ManagedModelCustomizationPolicy,
  type ManagedModelPreferences,
} from "./managed-model-customization";
import type { ManagedModelPreferenceVaultOptions } from "./managed-model-preference-vault";

export class AgentCustomizationService {
  constructor(
    protected readonly repository: RomeoRepository,
    protected readonly preferenceVaultOptions: ManagedModelPreferenceVaultOptions = {},
  ) {}

  async getCustomizationPolicy(
    agentId: string,
    subject: AuthSubject,
  ): Promise<ManagedModelCustomizationPolicy> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    return getManagedModelCustomizationPolicy(
      this.repository,
      agent.orgId,
      agent.id,
    );
  }

  async updateCustomizationPolicy(input: {
    agentId: string;
    subject: AuthSubject;
    policy: Partial<ManagedModelCustomizationPolicy>;
  }): Promise<ManagedModelCustomizationPolicy> {
    if (input.subject.isAdmin !== true) {
      throw new AuthorizationError(
        "Only an administrator can change managed-model customization policy.",
      );
    }
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:write",
    });
    const current = await getManagedModelCustomizationPolicy(
      this.repository,
      agent.orgId,
      agent.id,
    );
    const policy = await setManagedModelCustomizationPolicy(
      this.repository,
      agent.orgId,
      agent.id,
      { ...current, ...input.policy },
    );
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "agent.customization_policy.update",
      resourceType: "agent",
      resourceId: agent.id,
      metadata: {
        workspaceId: agent.workspaceId,
        enabledControls: Object.entries(policy)
          .filter(([, enabled]) => enabled)
          .map(([control]) => control),
      },
    });
    return policy;
  }

  async getPreferences(
    agentId: string,
    subject: AuthSubject,
  ): Promise<ManagedModelPreferences> {
    await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    return getManagedModelPreferences(
      this.repository,
      subject,
      agentId,
      undefined,
      this.preferenceVaultOptions,
    );
  }

  async updatePreferences(input: {
    agentId: string;
    subject: AuthSubject;
    preferences: Partial<ManagedModelPreferences>;
  }): Promise<ManagedModelPreferences> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:read",
    });
    const current = await getManagedModelPreferences(
      this.repository,
      input.subject,
      agent.id,
      undefined,
      this.preferenceVaultOptions,
    );
    const preferences = await setManagedModelPreferences(
      this.repository,
      input.subject,
      agent.id,
      { ...current, ...input.preferences },
      undefined,
      this.preferenceVaultOptions,
    );
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "agent.preferences.update",
      resourceType: "agent",
      resourceId: agent.id,
      metadata: {
        workspaceId: agent.workspaceId,
        configuredFields: Object.keys(preferences).sort(),
      },
    });
    return preferences;
  }

  async clearPreferences(
    agentId: string,
    subject: AuthSubject,
  ): Promise<ManagedModelPreferences> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    const preferences = await clearManagedModelPreferences(
      this.repository,
      subject,
      agent.id,
    );
    await writeAuditLog(this.repository, {
      subject,
      action: "agent.preferences.clear",
      resourceType: "agent",
      resourceId: agent.id,
      metadata: { workspaceId: agent.workspaceId },
    });
    return preferences;
  }
}
