import type {
  RagPolicyBudgetMap,
  RagPolicyExternalVectorStore,
  RagPolicyKnowledgeBaseTierAssignments,
  RagPolicyPhysicalVectorIsolation,
  RagPolicyProviderModel,
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

export interface StoredRagPolicy {
  version: 1;
  orgId: string;
  enabledTiers: RagPolicyTier[];
  defaultMaxResultsPerTier: RagPolicyBudgetMap;
  maxResultsPerTier: RagPolicyBudgetMap;
  allowedEmbeddingProviderModels: RagPolicyProviderModel[];
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
