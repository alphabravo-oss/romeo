import type {
  RagPolicyBudgetMap,
  RagPolicyExternalVectorStore,
  RagPolicyKnowledgeBaseTierAssignments,
  RagPolicyPhysicalVectorIsolation,
  RagPolicyAgenticSettings,
  RagPolicyProviderModel,
  RagPolicyRetrievalSettings,
  RagPolicyTier,
} from "../domain/rag-policy";

export const defaultBudget: RagPolicyBudgetMap = {
  user_private: 5,
  workspace: 5,
  org: 5,
  shared: 5,
};

export const defaultMaxBudget: RagPolicyBudgetMap = {
  user_private: 20,
  workspace: 20,
  org: 20,
  shared: 20,
};

export const defaultRetrievalSettings: RagPolicyRetrievalSettings = {
  topK: 5,
  similarityThreshold: 0.35,
  hybridSearch: true,
  hybridBm25Weight: 0.35,
};

export const defaultAgenticSettings: RagPolicyAgenticSettings = {
  enabled: false,
  userMode: "optional",
};

export interface StoredRagPolicy {
  version: 1;
  orgId: string;
  enabledTiers: RagPolicyTier[];
  defaultMaxResultsPerTier: RagPolicyBudgetMap;
  maxResultsPerTier: RagPolicyBudgetMap;
  allowedEmbeddingProviderModels: RagPolicyProviderModel[];
  retrieval: RagPolicyRetrievalSettings;
  agentic: RagPolicyAgenticSettings;
  knowledgeBaseTierAssignments: RagPolicyKnowledgeBaseTierAssignments;
  dataResidencyTags: string[];
  externalVectorStore: StoredExternalVectorStorePolicy;
  physicalVectorIsolation: StoredPhysicalVectorIsolationPolicy;
  updatedAt?: string;
  updatedBy?: string;
}

export type StoredExternalVectorStorePolicy = Omit<
  RagPolicyExternalVectorStore,
  "configured" | "restoreValidation"
>;

export type StoredPhysicalVectorIsolationPolicy = Omit<
  RagPolicyPhysicalVectorIsolation,
  "configured" | "liveEvidenceRequired" | "postgresAuthoritative"
>;
