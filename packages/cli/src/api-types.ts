/**
 * CLI-facing aliases derived exclusively from the generated OpenAPI SDK.
 * This module contains no handwritten wire contracts.
 */
export type {
  KnowledgeExtractionJobResult,
  KnowledgeSource,
  WebhookRetryResult,
} from "@romeo/api-client/generated/sdk";

import type {
  CompleteToolDispatchRequest,
  NotificationsRetryDueDeliveriesResponses,
  ToolDispatchRequestClaimResult,
  ToolDispatchRequestPayloadResult,
  ToolDispatchRequestReadbackResult,
} from "@romeo/api-client/generated/sdk";

export type NotificationRetryResult =
  NotificationsRetryDueDeliveriesResponses[202]["data"];
export type ToolOperationDispatchReadbackResponse =
  CompleteToolDispatchRequest["response"];
export type ToolOperationDispatchRequestClaimResult =
  ToolDispatchRequestClaimResult;
export type ToolOperationDispatchRequestPayloadResult =
  ToolDispatchRequestPayloadResult;
export type ToolOperationDispatchRequestReadbackResult =
  ToolDispatchRequestReadbackResult;
