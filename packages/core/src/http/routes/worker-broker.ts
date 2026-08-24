import {
  claimWorkerBrokerWorkRoute,
  completeWorkerBrokerClaimRoute,
  renewWorkerBrokerClaimRoute,
} from "@romeo/contracts";

import { ApiError } from "../../errors";
import type { WorkerBrokerService } from "../../services/worker-broker";
import type { RomeoApi } from "../context";

export function registerWorkerBrokerRoutes(
  app: RomeoApi,
  broker: WorkerBrokerService | undefined,
): void {
  app.openapi(claimWorkerBrokerWorkRoute, async (context) => {
    const service = configuredBroker(broker);
    const body = context.req.valid("json");
    const data = await service.claim({
      audience: context.req.valid("param").audience,
      authorization: context.req.header("authorization"),
      leaseSeconds: body.leaseSeconds,
      workerId: body.workerId,
      ...(body.payloadStorage === undefined
        ? {}
        : { payloadStorage: body.payloadStorage }),
    });
    return context.json({ data: claimResponse(data) }, 200);
  });
  app.openapi(renewWorkerBrokerClaimRoute, async (context) => {
    const service = configuredBroker(broker);
    const body = context.req.valid("json");
    const data = await service.renew({
      audience: context.req.valid("param").audience,
      authorization: context.req.header("authorization"),
      claimToken: body.claimToken,
      leaseSeconds: body.leaseSeconds,
      workerId: body.workerId,
    });
    return context.json({ data: claimResponse(data) }, 200);
  });
  app.openapi(completeWorkerBrokerClaimRoute, async (context) => {
    const service = configuredBroker(broker);
    const body = context.req.valid("json");
    const data = await service.complete({
      audience: context.req.valid("param").audience,
      authorization: context.req.header("authorization"),
      claimToken: body.claimToken,
      success: body.success,
      workerId: body.workerId,
      ...(body.errorCode === undefined ? {} : { errorCode: body.errorCode }),
      ...(body.response === undefined
        ? {}
        : { response: normalizedToolResponse(body.response) }),
      ...(body.result === undefined ? {} : { result: body.result }),
    });
    return context.json({ data: jsonObject(data) }, 200);
  });
}

function configuredBroker(
  broker: WorkerBrokerService | undefined,
): WorkerBrokerService {
  if (broker === undefined)
    throw new ApiError(
      "worker_broker_audience_unavailable",
      "The worker broker audience is not configured.",
      404,
    );
  return broker;
}

function claimResponse(input: {
  audience: "browser_automation" | "knowledge_extraction" | "tool_dispatch";
  claim?: unknown;
  claimed: boolean;
  claimToken?: string;
}) {
  return {
    audience: input.audience,
    claimed: input.claimed,
    ...(input.claim === undefined ? {} : { claim: jsonObject(input.claim) }),
    ...(input.claimToken === undefined ? {} : { claimToken: input.claimToken }),
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ApiError(
      "internal_error",
      "The worker broker produced an invalid response.",
      500,
    );
  return value as Record<string, unknown>;
}

function normalizedToolResponse(response: {
  bodyBytes: number;
  contentType?: string | undefined;
  ok: boolean;
  schemaValidation: {
    errorCode?: string | undefined;
    status: "failed" | "passed";
  };
  status: number;
  truncated: boolean;
}) {
  return {
    bodyBytes: response.bodyBytes,
    ok: response.ok,
    schemaValidation: {
      status: response.schemaValidation.status,
      ...(typeof response.schemaValidation.errorCode !== "string"
        ? {}
        : { errorCode: response.schemaValidation.errorCode }),
    },
    status: response.status,
    truncated: response.truncated,
    ...(typeof response.contentType !== "string"
      ? {}
      : { contentType: response.contentType }),
  };
}
