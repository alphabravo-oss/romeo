import type { PromptTemplate } from "@romeo/api-client/generated/sdk";
export type {
  PromptTemplate,
  PromptTemplateGrant,
} from "@romeo/api-client/generated/sdk";
export type CreatePromptTemplateInput =
  import("@romeo/api-client/generated/sdk").CreatePromptTemplateRequest;
export type UpdatePromptTemplateInput =
  import("@romeo/api-client/generated/sdk").UpdatePromptTemplateRequest;
export type SharePromptTemplateInput =
  import("@romeo/api-client/generated/sdk").SharePromptTemplateRequest;
export type PromptTemplateVisibility = PromptTemplate["visibility"];
