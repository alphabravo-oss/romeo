import type {
  CreateRagPolicyChangeRequest,
  RagPolicyReport,
  ReviewRagPolicyChangeRequest,
  UpdateRagPolicyRequest,
} from "@romeo/api-client/generated/sdk";

export type {
  RagPolicyChangeRequest,
  RagPolicyReport,
  RagPostureReport,
  UpdateRagPolicyRequest,
} from "@romeo/api-client/generated/sdk";

export type CreateRagPolicyChangeRequestInput = CreateRagPolicyChangeRequest;
export type ReviewRagPolicyChangeRequestInput = ReviewRagPolicyChangeRequest;
export type RagPolicyTier = RagPolicyReport["enabledTiers"][number];
export type RagPolicyExternalVectorMode =
  RagPolicyReport["externalVectorStore"]["mode"];
export type RagPolicyPhysicalVectorIsolationMode =
  RagPolicyReport["physicalVectorIsolation"]["mode"];
export type RagPolicyPhysicalVectorIsolationEnforcement =
  RagPolicyReport["physicalVectorIsolation"]["enforcement"];
export type RagVectorIsolationPolicy =
  RagPolicyReport["externalVectorStore"]["namespacePolicy"];
export type RagPolicyChangeJustificationCode = NonNullable<
  CreateRagPolicyChangeRequest["justificationCode"]
>;
export type RagPolicyChangeRejectReasonCode = NonNullable<
  ReviewRagPolicyChangeRequest["reasonCode"]
>;

export const ragPolicyTiers = [
  "user_private",
  "workspace",
  "org",
  "shared",
] as const satisfies readonly RagPolicyTier[];
export const ragVectorIsolationPolicies = [
  "knowledge_base",
  "none",
  "org",
  "workspace",
] as const satisfies readonly RagVectorIsolationPolicy[];
export const ragPolicyExternalVectorModes = [
  "deployment_managed",
  "disabled",
] as const satisfies readonly RagPolicyExternalVectorMode[];
export const ragPolicyPhysicalVectorIsolationModes = [
  "dedicated_vector_store_per_org",
  "external_collection_per_org",
  "external_namespace_per_org",
  "pgvector_partitioned_by_org",
  "shared_row_scope",
] as const satisfies readonly RagPolicyPhysicalVectorIsolationMode[];
export const ragPolicyPhysicalVectorIsolationEnforcements = [
  "advisory",
  "required",
] as const satisfies readonly RagPolicyPhysicalVectorIsolationEnforcement[];
export const ragPolicyChangeJustificationCodes = [
  "compliance_update",
  "incident_response",
  "manual_risk_reduction",
  "retrieval_replay_improvement",
] as const satisfies readonly RagPolicyChangeJustificationCode[];
export const ragPolicyChangeRejectReasonCodes = [
  "insufficient_evidence",
  "policy_conflict",
  "superseded",
  "unsafe_defaults",
] as const satisfies readonly RagPolicyChangeRejectReasonCode[];

export type RagPolicyPatch = UpdateRagPolicyRequest;
