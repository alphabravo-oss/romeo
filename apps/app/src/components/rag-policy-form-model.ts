import type { BaseModel, Provider } from "../features/providers/types";
import type {
  RagPolicyReport,
  RagPolicyTier,
  RagVectorBackendPreset,
} from "../features/rag-governance";
import { vectorBackendPresetFromPolicy } from "../features/rag-governance";
import type { MessageKey } from "../lib/i18n";

export const RAG_TIER_LABEL_KEYS: Record<RagPolicyTier, MessageKey> = {
  user_private: "ragTierUserPrivate",
  workspace: "ragTierWorkspace",
  org: "ragTierOrg",
  shared: "ragTierShared",
};

export const RAG_TIER_HELP_KEYS: Record<RagPolicyTier, MessageKey> = {
  user_private: "ragTierUserPrivateHelp",
  workspace: "ragTierWorkspaceHelp",
  org: "ragTierOrgHelp",
  shared: "ragTierSharedHelp",
};

export const RAG_BACKEND_LABEL_KEYS: Record<
  RagVectorBackendPreset,
  MessageKey
> = {
  pgvector: "ragBackendPgvector",
  qdrant: "ragBackendQdrant",
};

export function ragEmbeddingOptions(
  models: BaseModel[],
  providers: Provider[],
) {
  const providerById = new Map(
    providers.map((provider) => [provider.id, provider]),
  );
  return models
    .filter(
      (model) =>
        model.enabled && model.capabilities.modalities.includes("embeddings"),
    )
    .map((model) => ({
      providerId: model.providerId,
      model: model.name,
      label: `${providerById.get(model.providerId)?.name ?? model.providerId} · ${model.displayName || model.name}`,
    }));
}

export function ragPolicyFormDefaults(report: RagPolicyReport) {
  return {
    vectorBackend: vectorBackendPresetFromPolicy(report),
    enabledTiers: report.enabledTiers,
    embeddingKey: embeddingKeyFromPolicy(report),
    topK: String(
      report.retrieval?.topK ?? report.defaultMaxResultsPerTier.workspace,
    ),
    similarityThreshold: String(report.retrieval?.similarityThreshold ?? 0.35),
    hybridSearch: report.retrieval?.hybridSearch ?? true,
    hybridBm25Weight: String(report.retrieval?.hybridBm25Weight ?? 0.35),
    agenticEnabled: report.agentic?.enabled ?? false,
    agenticUserMode: report.agentic?.userMode ?? "optional",
    dataResidencyTags: report.dataResidencyTags.join("\n"),
  } as const;
}

export function parseRagRetrievalNumbers(value: {
  hybridBm25Weight: string;
  similarityThreshold: string;
  topK: string;
}) {
  const topK = Number(value.topK);
  const similarityThreshold = Number(value.similarityThreshold);
  const hybridBm25Weight = Number(value.hybridBm25Weight);
  if (
    !Number.isInteger(topK) ||
    topK < 1 ||
    topK > 20 ||
    !Number.isFinite(similarityThreshold) ||
    similarityThreshold < 0 ||
    similarityThreshold > 1 ||
    !Number.isFinite(hybridBm25Weight) ||
    hybridBm25Weight < 0 ||
    hybridBm25Weight > 1
  ) {
    return undefined;
  }
  return { hybridBm25Weight, similarityThreshold, topK };
}

export function embeddingFromKey(
  key: string,
): { providerId: string; model: string } | undefined {
  if (key.length === 0) return undefined;
  const separator = key.indexOf("\0");
  if (separator <= 0) return undefined;
  const providerId = key.slice(0, separator);
  const model = key.slice(separator + 1);
  return providerId.length === 0 || model.length === 0
    ? undefined
    : { providerId, model };
}

function embeddingKeyFromPolicy(report: RagPolicyReport): string {
  const first = report.allowedEmbeddingProviderModels[0];
  return first === undefined ? "" : `${first.providerId}\0${first.model}`;
}
