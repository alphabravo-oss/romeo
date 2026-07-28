import type {
  BackgroundJob,
  ToolConnector,
  ToolOperation,
  ToolOperationDispatchRequestClaimResult,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import {
  asRecord,
  jobPayloadStorage,
  jobPayloadStoreReference,
  jobTransport,
  payloadString,
  payloadStringArray,
  readWorkerLease,
} from "./tool-operation-dispatch-request-payload";
import { workerQueue } from "./tool-operation-dispatch-request-types";

export async function claimResult(
  repository: RomeoRepository,
  job: BackgroundJob,
): Promise<ToolOperationDispatchRequestClaimResult> {
  const lease = readWorkerLease(job);
  if (lease === undefined) {
    throw new ApiError(
      "tool_operation_dispatch_request_lease_invalid",
      "Tool operation dispatch request lease is invalid or expired.",
      409,
    );
  }
  const responseValidation = await responseValidationPlan(repository, job);
  const authPolicy = await dispatchAuthPolicy(repository, job);
  const payloadStore = jobPayloadStoreReference(job);
  const transport = jobTransport(job);
  return {
    claimed: true,
    job: { id: job.id, type: job.type, status: job.status },
    connectorId: payloadString(job, "connectorId"),
    operationId: payloadString(job, "operationId"),
    method: payloadString(job, "method"),
    pathTemplate: payloadString(job, "path"),
    workerQueue,
    request: {
      parameterKeys: payloadStringArray(job, "parameterKeys"),
      bodyKeys: payloadStringArray(job, "bodyKeys"),
      host: payloadString(job, "host"),
      payloadStorage: jobPayloadStorage(job),
    },
    ...(payloadStore === undefined ? {} : { payloadStore }),
    lease,
    ...(authPolicy === undefined ? {} : { authPolicy }),
    ...(responseValidation === undefined ? {} : { responseValidation }),
    ...(transport === undefined ? {} : { transport }),
  };
}

async function dispatchAuthPolicy(
  repository: RomeoRepository,
  job: BackgroundJob,
): Promise<ToolOperationDispatchRequestClaimResult["authPolicy"]> {
  const connector = await dispatchConnector(repository, job);
  if (connector === undefined) return undefined;
  const type =
    typeof connector.authConfig.type === "string"
      ? connector.authConfig.type
      : "none";
  if (
    type !== "none" &&
    type !== "api_key" &&
    type !== "bearer" &&
    type !== "oauth2_client_credentials"
  ) {
    return { type: "none" };
  }
  if (type !== "oauth2_client_credentials") return { type };
  const tokenUrl =
    typeof connector.authConfig.oauthTokenUrl === "string"
      ? connector.authConfig.oauthTokenUrl
      : undefined;
  if (tokenUrl === undefined) return { type };
  const scopes = Array.isArray(connector.authConfig.oauthScopes)
    ? connector.authConfig.oauthScopes.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const clientAuthMethod =
    connector.authConfig.oauthClientAuthMethod === "client_secret_post"
      ? "client_secret_post"
      : "client_secret_basic";
  return {
    type,
    oauthTokenUrl: tokenUrl,
    oauthScopes: scopes,
    oauthClientAuthMethod: clientAuthMethod,
  };
}

async function responseValidationPlan(
  repository: RomeoRepository,
  job: BackgroundJob,
): Promise<ToolOperationDispatchRequestClaimResult["responseValidation"]> {
  const connectorId = payloadString(job, "connectorId");
  const operationId = payloadString(job, "operationId");
  const operation = (await repository.listToolOperations(connectorId)).find(
    (item) => item.operationId === operationId,
  );
  if (operation === undefined) return undefined;
  const jsonSchemas = responseJsonSchemas(operation);
  return Object.keys(jsonSchemas).length === 0 ? undefined : { jsonSchemas };
}

async function dispatchConnector(
  repository: RomeoRepository,
  job: BackgroundJob,
): Promise<ToolConnector | undefined> {
  const connectorId = payloadString(job, "connectorId");
  return (await repository.listToolConnectors(job.orgId)).find(
    (item) => item.id === connectorId,
  );
}

function responseJsonSchemas(
  operation: ToolOperation,
): Record<string, Record<string, unknown>> {
  const responses = asRecord(operation.outputSchema);
  if (responses === undefined) return {};
  const schemas: Record<string, Record<string, unknown>> = {};
  for (const [status, responseValue] of Object.entries(responses)) {
    if (!/^(default|[1-5][0-9][0-9])$/u.test(status)) continue;
    const response = asRecord(responseValue);
    const content = asRecord(response?.content);
    if (content === undefined) continue;
    const jsonContent =
      asRecord(content["application/json"]) ??
      asRecord(
        Object.entries(content).find(([mediaType]) =>
          isJsonContentType(mediaType),
        )?.[1],
      );
    const schema = validationSchemaSubset(asRecord(jsonContent?.schema), 0);
    if (schema !== undefined) schemas[status] = schema;
  }
  return schemas;
}

function validationSchemaSubset(
  schema: Record<string, unknown> | undefined,
  depth: number,
): Record<string, unknown> | undefined {
  if (schema === undefined || depth > 6) return undefined;
  const output: Record<string, unknown> = {};
  if (typeof schema.type === "string") output.type = schema.type;
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter(
      (item): item is string => typeof item === "string",
    );
    if (types.length > 0) output.type = types;
  }
  if (Array.isArray(schema.enum)) output.enum = schema.enum;
  if (Array.isArray(schema.required)) {
    const required = schema.required.filter(
      (item): item is string => typeof item === "string",
    );
    if (required.length > 0) output.required = required;
  }
  const properties = asRecord(schema.properties);
  if (properties !== undefined) {
    const propertySchemas: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      const child = validationSchemaSubset(asRecord(value), depth + 1);
      if (child !== undefined) propertySchemas[key] = child;
    }
    if (Object.keys(propertySchemas).length > 0)
      output.properties = propertySchemas;
  }
  const items = validationSchemaSubset(asRecord(schema.items), depth + 1);
  if (items !== undefined) output.items = items;
  return Object.keys(output).length === 0 ? undefined : output;
}

function isJsonContentType(contentType: string): boolean {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized === "application/json" || normalized.endsWith("+json");
}
