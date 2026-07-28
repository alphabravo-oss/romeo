import type {
  ManagedModelsDiffVersionResponse,
  ManagedModel as GeneratedManagedModel,
  ManagedModelCustomizationPolicy,
  ManagedModelGalleryItem,
  ManagedModelGrant,
  ManagedModelKnowledgeBinding,
  ManagedModelMemoryPolicy,
  ManagedModelPreferences,
  ManagedModelSafetySettings,
  ManagedModelVersion,
} from "@romeo/api-client/generated/sdk";

export type Agent = GeneratedManagedModel;
export type AgentMemoryPolicy = ManagedModelMemoryPolicy;
export type AgentSafetySettings = ManagedModelSafetySettings;
export type AgentVersion = ManagedModelVersion;
export type AgentVersionDiff = ManagedModelsDiffVersionResponse["data"];
export type AgentVersionDiffChange = AgentVersionDiff["changes"][number];
export type AgentGalleryItem = ManagedModelGalleryItem;
export type AgentGrant = ManagedModelGrant;
export type AgentKnowledgeBinding = ManagedModelKnowledgeBinding;
export type { ManagedModelCustomizationPolicy, ManagedModelPreferences };

export type AgentPromptInjectionGuard = NonNullable<
  AgentSafetySettings["promptInjectionGuard"]
>;
