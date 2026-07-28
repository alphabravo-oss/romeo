import {
  deviceAuthorizationsCreate,
  deviceAuthorizationsList,
  deviceAuthorizationsRefresh,
  deviceAuthorizationsRevoke,
  type CreateDeviceAuthorizationRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import type { ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import { csvFlag, optionalIntegerFlag, requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface DeviceCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeDeviceCommand(
  area: string,
  action: string | undefined,
  context: DeviceCommandContext,
): Promise<number> | undefined {
  if (area !== "devices") return undefined;
  if (action === "list") return result(context, listDevices(context));
  if (action === "create") return result(context, createDevice(context));
  if (action === "refresh") return result(context, refreshDevice(context));
  if (action === "revoke") return result(context, revokeDevice(context));
  return undefined;
}

function listDevices(context: DeviceCommandContext) {
  return deviceAuthorizationsList({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function createDevice(context: DeviceCommandContext) {
  const body: CreateDeviceAuthorizationRequest = {
    name: requiredFlag(context.parsed, "name"),
    scopes: scopeCsvFlag(context.parsed, "scopes"),
    ...optionalTtlDays(context.parsed),
  };
  return deviceAuthorizationsCreate({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function refreshDevice(context: DeviceCommandContext) {
  const refreshToken = requiredFlag(context.parsed, "refresh-token");
  return deviceAuthorizationsRefresh({
    body: { refreshToken },
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function revokeDevice(context: DeviceCommandContext) {
  const deviceAuthorizationId = requiredFlag(
    context.parsed,
    "device",
    "device-authorization",
  );
  return deviceAuthorizationsRevoke({
    client: generatedClient(context),
    path: { deviceAuthorizationId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(context: DeviceCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function optionalTtlDays(parsed: ParsedArgs): { ttlDays?: number } {
  const ttlDays = optionalIntegerFlag(parsed, "ttl-days");
  return ttlDays === undefined ? {} : { ttlDays };
}

function scopeCsvFlag(
  parsed: ParsedArgs,
  name: string,
): CreateDeviceAuthorizationRequest["scopes"] {
  const scopes = csvFlag(parsed, name);
  if (scopes.length === 0) throw new CliUsageError(`Missing --${name}.`);
  return scopes as CreateDeviceAuthorizationRequest["scopes"];
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: DeviceCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
