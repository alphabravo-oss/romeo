import type {
  ToolOperationDispatchRequestClaimResult,
  ToolOperationDispatchRequestPayloadResult,
} from "./api-types";
import type {
  BrowserAutomationTaskClaimResult,
  BrowserAutomationWorkerClient,
} from "./browser-automation-worker";
import type { CommandContext } from "./commands";
import type { KnowledgeExtractionWorkerClient } from "./knowledge-worker";
import type { ToolDispatchWorkerClient } from "./tool-dispatch-worker";
import { workerBrokerHttpClient } from "./worker-broker-client";

export function brokerToolWorkerClient(
  context: CommandContext,
): ToolDispatchWorkerClient {
  const broker = workerBrokerHttpClient(context, "tool_dispatch");
  const tokens = new Map<string, string>();
  const payloads = new Map<string, ToolOperationDispatchRequestPayloadResult>();
  return {
    tool: {
      claimDispatchRequest: async (input = {}) => {
        const result = await broker.claim({
          leaseSeconds: input.leaseSeconds ?? 300,
          ...(input.payloadStorage === undefined
            ? {}
            : { payloadStorage: input.payloadStorage }),
        });
        if (!result.claimed)
          return { claimed: false, workerQueue: "external_tool_operations" };
        const claim =
          result.claim as ToolOperationDispatchRequestClaimResult & {
            payload?: ToolOperationDispatchRequestPayloadResult["payload"];
          };
        rememberClaim(result.claimToken, claim.job?.id, tokens);
        if (claim.job?.id !== undefined && claim.payload !== undefined)
          payloads.set(claim.job.id, toolPayloadResult(claim));
        return claim;
      },
      readDispatchRequestPayload: async ({ jobId }) => {
        const payload = payloads.get(jobId);
        if (payload === undefined)
          throw new Error("worker_payload_unavailable");
        return payload;
      },
      renewDispatchRequest: async ({ jobId, leaseSeconds }) => {
        const result = await broker.renew({
          claimToken: requiredToken(tokens, jobId),
          leaseSeconds,
        });
        rememberClaim(result.claimToken, jobId, tokens);
        return result.claim as ToolOperationDispatchRequestClaimResult;
      },
      completeDispatchRequest: async ({ jobId, response }) => {
        try {
          return (await broker.complete({
            claimToken: requiredToken(tokens, jobId),
            response,
            success: true,
          })) as never;
        } finally {
          tokens.delete(jobId);
          payloads.delete(jobId);
        }
      },
      failDispatchRequest: async ({ errorCode, jobId }) => {
        try {
          return (await broker.complete({
            claimToken: requiredToken(tokens, jobId),
            errorCode,
            success: false,
          })) as never;
        } finally {
          tokens.delete(jobId);
          payloads.delete(jobId);
        }
      },
    },
  };
}

export function brokerBrowserWorkerClient(
  context: CommandContext,
): BrowserAutomationWorkerClient {
  const broker = workerBrokerHttpClient(context, "browser_automation");
  const tokens = new Map<string, string>();
  return {
    browserAutomation: {
      claimBrowserTask: async (input = {}) => {
        const result = await broker.claim({
          leaseSeconds: input.leaseSeconds ?? 300,
        });
        if (!result.claimed)
          return { claimed: false } as BrowserAutomationTaskClaimResult;
        const claim = result.claim as BrowserAutomationTaskClaimResult;
        rememberClaim(result.claimToken, claim.job?.id, tokens);
        return claim;
      },
      renewBrowserTask: async ({ jobId, leaseSeconds }) => {
        const result = await broker.renew({
          claimToken: requiredToken(tokens, jobId),
          leaseSeconds,
        });
        rememberClaim(result.claimToken, jobId, tokens);
        return result.claim as BrowserAutomationTaskClaimResult;
      },
      completeBrowserTask: async ({ jobId, result }) => {
        try {
          return await broker.complete({
            claimToken: requiredToken(tokens, jobId),
            result,
            success: true,
          });
        } finally {
          tokens.delete(jobId);
        }
      },
      failBrowserTask: async ({ errorCode, jobId }) => {
        try {
          return await broker.complete({
            claimToken: requiredToken(tokens, jobId),
            errorCode,
            success: false,
          });
        } finally {
          tokens.delete(jobId);
        }
      },
    },
  };
}

export function brokerKnowledgeWorkerClient(
  context: CommandContext,
): KnowledgeExtractionWorkerClient {
  const broker = workerBrokerHttpClient(context, "knowledge_extraction");
  const tokens = new Map<string, string>();
  return {
    claimExtraction: async ({ leaseSeconds }) => {
      const result = await broker.claim({ leaseSeconds });
      if (!result.claimed) return { claimed: false };
      const claim = result.claim as {
        source?: { id?: string } & Record<string, unknown>;
      };
      if (claim.source === undefined)
        throw new Error("worker_broker_claim_invalid");
      rememberClaim(result.claimToken, claim.source?.id, tokens);
      return { claimed: true, source: claim.source };
    },
    completeExtraction: async ({ errorCode, sourceId, success }) => {
      try {
        return await broker.complete({
          claimToken: requiredToken(tokens, sourceId),
          success,
          ...(errorCode === undefined ? {} : { errorCode }),
        });
      } finally {
        tokens.delete(sourceId);
      }
    },
  };
}

function toolPayloadResult(
  claim: ToolOperationDispatchRequestClaimResult & {
    payload?: ToolOperationDispatchRequestPayloadResult["payload"];
  },
): ToolOperationDispatchRequestPayloadResult {
  if (
    claim.job === undefined ||
    claim.payload === undefined ||
    claim.connectorId === undefined ||
    claim.operationId === undefined ||
    claim.method === undefined ||
    claim.pathTemplate === undefined ||
    claim.request === undefined
  ) {
    throw new Error("worker_broker_claim_invalid");
  }
  return {
    connectorId: claim.connectorId,
    job: claim.job,
    method: claim.method,
    operationId: claim.operationId,
    pathTemplate: claim.pathTemplate,
    payload: claim.payload,
    request: claim.request,
    workerQueue: claim.workerQueue,
  };
}

function rememberClaim(
  token: string | undefined,
  workId: string | undefined,
  tokens: Map<string, string>,
): void {
  if (token === undefined || workId === undefined)
    throw new Error("worker_broker_claim_invalid");
  tokens.set(workId, token);
}

function requiredToken(tokens: Map<string, string>, workId: string): string {
  const token = tokens.get(workId);
  if (token === undefined) throw new Error("worker_broker_claim_token_missing");
  return token;
}
