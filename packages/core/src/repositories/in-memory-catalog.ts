import type * as Auth from "@romeo/auth";
import type * as Ai from "@romeo/ai-runtime";

import type * as OAuth from "../domain/delegated-oauth";
import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import {
  append,
  appendMany,
  removeById,
  replaceById,
} from "./collection-helpers";
import { InMemoryAuthRepository } from "./in-memory-auth";

export abstract class InMemoryCatalogRepository extends InMemoryAuthRepository {
  async listProviders(orgId: string): Promise<E.ProviderInstance[]> {
    return this.data.providers
      .filter((provider) => provider.orgId === orgId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getProvider(
    providerId: string,
  ): Promise<E.ProviderInstance | undefined> {
    return this.data.providers.find((provider) => provider.id === providerId);
  }

  async createProvider(
    provider: E.ProviderInstance,
  ): Promise<E.ProviderInstance> {
    return append(this.data.providers, provider);
  }

  async updateProvider(
    provider: E.ProviderInstance,
  ): Promise<E.ProviderInstance> {
    return replaceById(this.data.providers, provider);
  }

  async listModels(orgId: string): Promise<E.BaseModel[]> {
    const providerIds = new Set(
      this.data.providers
        .filter((provider) => provider.orgId === orgId)
        .map((provider) => provider.id),
    );
    return this.data.models
      .filter((model) => providerIds.has(model.providerId))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async listModelsPage(
    orgId: string,
    input: R.ModelCatalogQuery,
  ): Promise<{ items: E.BaseModel[]; total: number }> {
    const providerIds = new Set(
      this.data.providers
        .filter((provider) => provider.orgId === orgId)
        .map((provider) => provider.id),
    );
    const query = input.query?.trim().toLocaleLowerCase() ?? "";
    const models = this.data.models
      .filter((model) => providerIds.has(model.providerId))
      .filter(
        (model) =>
          input.providerId === undefined ||
          model.providerId === input.providerId,
      )
      .filter(
        (model) =>
          input.enabled === undefined || model.enabled === input.enabled,
      )
      .filter(
        (model) =>
          input.available === undefined ||
          (model.available !== false) === input.available,
      )
      .filter(
        (model) =>
          query === "" ||
          `${model.name} ${model.displayName}`
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort((left, right) => {
        const direction = input.direction === "desc" ? -1 : 1;
        const comparison =
          input.sort === "name"
            ? left.name.localeCompare(right.name)
            : input.sort === "availability"
              ? Number(left.available !== false) -
                Number(right.available !== false)
              : input.sort === "enabled"
                ? Number(left.enabled) - Number(right.enabled)
                : input.sort === "contextWindow"
                  ? left.contextWindow - right.contextWindow
                  : left.displayName.localeCompare(right.displayName);
        return (comparison || left.id.localeCompare(right.id)) * direction;
      });
    return {
      items: models.slice(input.offset, input.offset + input.limit),
      total: models.length,
    };
  }

  async getModel(modelId: string): Promise<E.BaseModel | undefined> {
    return this.data.models.find((model) => model.id === modelId);
  }

  async updateModel(model: E.BaseModel): Promise<E.BaseModel> {
    return replaceById(this.data.models, model);
  }

  async upsertModels(models: E.BaseModel[]): Promise<E.BaseModel[]> {
    for (const model of models) {
      const index = this.data.models.findIndex((item) => item.id === model.id);
      if (index >= 0) {
        this.data.models[index] = model;
      } else {
        this.data.models.push(model);
      }
    }

    return models;
  }

  async listAgents(workspaceId: string): Promise<E.Agent[]> {
    return this.data.agents.filter(
      (agent) =>
        agent.workspaceId === workspaceId && agent.archivedAt === undefined,
    );
  }

  async createAgent(agent: E.Agent): Promise<E.Agent> {
    return append(this.data.agents, agent);
  }

  async archiveAgent(
    agentId: string,
    archivedAt: string,
  ): Promise<E.Agent | undefined> {
    const agent = this.data.agents.find(
      (candidate) => candidate.id === agentId,
    );
    if (!agent) return undefined;
    return replaceById(this.data.agents, {
      ...agent,
      archivedAt,
      updatedAt: archivedAt,
    });
  }

  async updateAgent(agent: E.Agent): Promise<E.Agent> {
    return replaceById(this.data.agents, agent);
  }

  async getAgent(agentId: string): Promise<E.Agent | undefined> {
    return this.data.agents.find((agent) => agent.id === agentId);
  }

  async listAgentKnowledgeBindings(
    agentId: string,
  ): Promise<E.AgentKnowledgeBinding[]> {
    return this.data.agentKnowledgeBindings.filter(
      (binding) => binding.agentId === agentId,
    );
  }

  async upsertAgentKnowledgeBinding(
    binding: E.AgentKnowledgeBinding,
  ): Promise<E.AgentKnowledgeBinding> {
    const index = this.data.agentKnowledgeBindings.findIndex(
      (item) =>
        item.agentId === binding.agentId &&
        item.knowledgeBaseId === binding.knowledgeBaseId,
    );
    if (index >= 0) this.data.agentKnowledgeBindings[index] = binding;
    else this.data.agentKnowledgeBindings.push(binding);
    return binding;
  }

  async listAgentToolBindings(agentId: string): Promise<E.AgentToolBinding[]> {
    return this.data.agentToolBindings.filter(
      (binding) => binding.agentId === agentId,
    );
  }

  async upsertAgentToolBinding(
    binding: E.AgentToolBinding,
  ): Promise<E.AgentToolBinding> {
    const index = this.data.agentToolBindings.findIndex(
      (item) =>
        item.agentId === binding.agentId && item.toolId === binding.toolId,
    );
    if (index >= 0) this.data.agentToolBindings[index] = binding;
    else this.data.agentToolBindings.push(binding);
    return binding;
  }

  async listAgentVersions(agentId: string): Promise<E.AgentVersion[]> {
    return this.data.agentVersions
      .filter((version) => version.agentId === agentId)
      .sort((left, right) => right.version - left.version);
  }

  async getAgentVersion(
    versionId: string,
  ): Promise<E.AgentVersion | undefined> {
    return this.data.agentVersions.find((version) => version.id === versionId);
  }

  async createAgentVersion(version: E.AgentVersion): Promise<E.AgentVersion> {
    return append(this.data.agentVersions, version);
  }

  async getManagedModelCustomizationPolicy(
    orgId: string,
    agentId: string,
  ): Promise<E.ManagedModelCustomizationPolicyRecord | undefined> {
    return this.data.managedModelCustomizationPolicies.find(
      (policy) => policy.orgId === orgId && policy.agentId === agentId,
    );
  }

  async upsertManagedModelCustomizationPolicy(
    policy: E.ManagedModelCustomizationPolicyRecord,
  ): Promise<E.ManagedModelCustomizationPolicyRecord> {
    const index = this.data.managedModelCustomizationPolicies.findIndex(
      (item) => item.orgId === policy.orgId && item.agentId === policy.agentId,
    );
    if (index < 0)
      return append(this.data.managedModelCustomizationPolicies, policy);
    this.data.managedModelCustomizationPolicies[index] = policy;
    return policy;
  }

  async getManagedModelPreference(
    orgId: string,
    agentId: string,
    principalType: Auth.PrincipalType,
    principalId: string,
  ): Promise<E.ManagedModelPreferenceRecord | undefined> {
    return this.data.managedModelPreferences.find(
      (preference) =>
        preference.orgId === orgId &&
        preference.agentId === agentId &&
        preference.principalType === principalType &&
        preference.principalId === principalId,
    );
  }

  async listManagedModelPreferences(
    orgId: string,
    agentId: string,
  ): Promise<E.ManagedModelPreferenceRecord[]> {
    return this.data.managedModelPreferences.filter(
      (preference) =>
        preference.orgId === orgId && preference.agentId === agentId,
    );
  }

  async upsertManagedModelPreference(
    preference: E.ManagedModelPreferenceRecord,
  ): Promise<E.ManagedModelPreferenceRecord> {
    const index = this.data.managedModelPreferences.findIndex(
      (item) =>
        item.orgId === preference.orgId &&
        item.agentId === preference.agentId &&
        item.principalType === preference.principalType &&
        item.principalId === preference.principalId,
    );
    if (index < 0) return append(this.data.managedModelPreferences, preference);
    this.data.managedModelPreferences[index] = preference;
    return preference;
  }

  async deleteManagedModelPreference(
    orgId: string,
    agentId: string,
    principalType: Auth.PrincipalType,
    principalId: string,
  ): Promise<void> {
    const index = this.data.managedModelPreferences.findIndex(
      (item) =>
        item.orgId === orgId &&
        item.agentId === agentId &&
        item.principalType === principalType &&
        item.principalId === principalId,
    );
    if (index >= 0) this.data.managedModelPreferences.splice(index, 1);
  }
}
