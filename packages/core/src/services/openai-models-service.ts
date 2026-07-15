import { assertScope, hasGrant, type AuthSubject } from "@romeo/auth";
import type { BaseModel, ProviderInstance } from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";

export interface OpenAiModelListResponse {
  object: "list";
  data: OpenAiModel[];
}

export interface OpenAiModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export class OpenAiModelsService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(subject: AuthSubject): Promise<OpenAiModelListResponse> {
    const visibleModels = await this.visibleModelEntries(subject);
    const nameCounts = modelNameCounts(visibleModels.map(({ model }) => model));

    return {
      object: "list",
      data: visibleModels
        .map(({ model, provider }) =>
          toOpenAiModel(model, provider, nameCounts),
        )
        .sort((left, right) => left.id.localeCompare(right.id)),
    };
  }

  async retrieve(subject: AuthSubject, modelRef: string): Promise<OpenAiModel> {
    const trimmed = modelRef.trim();
    if (trimmed.length === 0) throw notFound("Model");

    const visibleModels = await this.visibleModelEntries(subject);
    const byId = visibleModels.find(({ model }) => model.id === trimmed);
    if (byId !== undefined) {
      return toOpenAiModel(
        byId.model,
        byId.provider,
        modelNameCounts(visibleModels.map(({ model }) => model)),
      );
    }

    const byName = visibleModels.filter(({ model }) => model.name === trimmed);
    if (byName.length === 0) throw notFound("Model");
    if (byName.length > 1) {
      throw new ApiError(
        "model_ambiguous",
        "Multiple visible models match the requested OpenAI-compatible model name.",
        409,
        { model: trimmed },
      );
    }
    const entry = byName[0]!;
    return toOpenAiModel(
      entry.model,
      entry.provider,
      modelNameCounts(visibleModels.map(({ model }) => model)),
    );
  }

  private async visibleModelEntries(
    subject: AuthSubject,
  ): Promise<Array<{ model: BaseModel; provider: ProviderInstance }>> {
    assertScope(subject, "models:use");

    const [models, providers, grants] = await Promise.all([
      this.repository.listModels(subject.orgId),
      this.repository.listProviders(subject.orgId),
      this.repository.listResourceGrants(subject.orgId),
    ]);
    const providerById = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
    return models
      .map((model) => ({ model, provider: providerById.get(model.providerId) }))
      .filter(
        (entry): entry is { model: BaseModel; provider: ProviderInstance } =>
          entry.provider !== undefined &&
          entry.model.enabled &&
          entry.provider.enabled &&
          hasGrant(subject, grants, "model", entry.model.id, "use") &&
          hasGrant(subject, grants, "provider", entry.provider.id, "use"),
      );
  }
}

function toOpenAiModel(
  model: BaseModel,
  provider: ProviderInstance,
  nameCounts: Map<string, number>,
): OpenAiModel {
  return {
    id: nameCounts.get(model.name) === 1 ? model.name : model.id,
    object: "model",
    created: 0,
    owned_by: provider.type,
  };
}

function modelNameCounts(models: BaseModel[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const model of models) {
    counts.set(model.name, (counts.get(model.name) ?? 0) + 1);
  }
  return counts;
}
