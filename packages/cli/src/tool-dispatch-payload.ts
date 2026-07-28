import type {
  ToolDispatchPayload,
  ToolDispatchPayloadAuth,
} from "./tool-dispatch-worker";
import { CliUsageError } from "./cli-errors";

export function parseToolDispatchPayloadFile(
  content: string,
): Record<string, ToolDispatchPayload> {
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliUsageError("--payload-file must contain a JSON object.");
  }
  const payloads: Record<string, ToolDispatchPayload> = {};
  for (const [jobId, value] of Object.entries(parsed)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new CliUsageError(
        "--payload-file entries must be JSON objects keyed by dispatch job ID.",
      );
    }
    const record = value as Record<string, unknown>;
    const payload: ToolDispatchPayload = {};
    if (record.parameters !== undefined)
      payload.parameters = jsonObject(record.parameters, "parameters");
    if (record.body !== undefined)
      payload.body = jsonObject(record.body, "body");
    if (record.headers !== undefined)
      payload.headers = stringRecord(record.headers, "headers");
    if (record.auth !== undefined)
      payload.auth = toolDispatchPayloadAuth(record.auth);
    payloads[jobId] = payload;
  }
  return payloads;
}

function toolDispatchPayloadAuth(value: unknown): ToolDispatchPayloadAuth {
  const record = jsonObject(value, "auth");
  const { type, secretRef } = record;
  if (typeof secretRef !== "string" || secretRef.length === 0) {
    throw new CliUsageError("--payload-file auth.secretRef must be a string.");
  }
  if (type === "bearer") return { type, secretRef };
  if (type === "api_key") {
    const { apiKeyIn, apiKeyName } = record;
    if (
      apiKeyIn !== undefined &&
      apiKeyIn !== "header" &&
      apiKeyIn !== "query"
    ) {
      throw new CliUsageError(
        "--payload-file auth.apiKeyIn must be header or query.",
      );
    }
    if (apiKeyName !== undefined && typeof apiKeyName !== "string") {
      throw new CliUsageError(
        "--payload-file auth.apiKeyName must be a string.",
      );
    }
    return {
      type,
      secretRef,
      ...(apiKeyIn === undefined ? {} : { apiKeyIn }),
      ...(apiKeyName === undefined ? {} : { apiKeyName }),
    };
  }
  if (type === "oauth2_client_credentials") return { type, secretRef };
  throw new CliUsageError(
    "--payload-file auth.type must be bearer, api_key, or oauth2_client_credentials.",
  );
}

function jsonObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value))
    return value as Record<string, unknown>;
  throw new CliUsageError(`--payload-file ${name} entries must be objects.`);
}

function stringRecord(value: unknown, name: string): Record<string, string> {
  const record = jsonObject(value, name);
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string") {
      throw new CliUsageError(
        `--payload-file ${name}.${key} must be a string.`,
      );
    }
  }
  return record as Record<string, string>;
}
