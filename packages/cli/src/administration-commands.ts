import {
  administrationAddGroupMember,
  administrationCreateGroup,
  administrationDisableUser,
  administrationListGroupMembers,
  administrationListGroups,
  administrationListUsers,
  administrationRemoveGroupMember,
  authProviderAdministrationDeprovisionOidcUser,
  ssoAdministrationGetSettings,
  ssoAdministrationTestSettings,
  ssoAdministrationUpdateSettings,
  type UpdateSsoSettingsRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, hasFlag, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import {
  optionalCsvFlag,
  optionalMappingFlag,
  requiredFlag,
} from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface AdministrationCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeAdministrationCommand(
  area: string,
  action: string | undefined,
  context: AdministrationCommandContext,
): Promise<number> | undefined {
  const command = administrationCommand(area, action, context);
  return command === undefined ? undefined : result(context, command);
}

function administrationCommand(
  area: string,
  action: string | undefined,
  context: AdministrationCommandContext,
): Promise<unknown> | undefined {
  if (area === "sso" && action === "settings") return getSsoSettings(context);
  if (area === "sso" && action === "update") return updateSsoSettings(context);
  if (area === "sso" && action === "test") return testSsoSettings(context);
  if (area === "sso" && action === "deprovision-oidc")
    return deprovisionOidcUser(context);
  if (area === "users" && action === "list") return listUsers(context);
  if (area === "users" && action === "disable") return disableUser(context);
  if (area === "groups" && action === "list") return listGroups(context);
  if (area === "groups" && action === "create") return createGroup(context);
  if (area === "groups" && action === "members")
    return listGroupMembers(context);
  if (area === "groups" && action === "add-member")
    return addGroupMember(context);
  if (area === "groups" && action === "remove-member")
    return removeGroupMember(context);
  return undefined;
}

function getSsoSettings(context: AdministrationCommandContext) {
  return ssoAdministrationGetSettings({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function updateSsoSettings(context: AdministrationCommandContext) {
  if (
    hasFlag(context.parsed.flags, "enable") &&
    hasFlag(context.parsed.flags, "disable")
  )
    throw new CliUsageError("Use either --enable or --disable, not both.");
  const enabled = hasFlag(context.parsed.flags, "enable")
    ? true
    : hasFlag(context.parsed.flags, "disable")
      ? false
      : undefined;
  const body: UpdateSsoSettingsRequest = {
    oidc: {
      ...(enabled === undefined ? {} : { enabled }),
      ...optionalString(context.parsed, "issuer-url", "issuerUrl"),
      ...optionalString(context.parsed, "client-id", "clientId"),
      ...optionalString(context.parsed, "group-claim", "groupClaim"),
      ...optionalArray(context.parsed, "admin-groups", "adminGroups"),
      ...optionalMap(context.parsed, "group-map", "groupMap"),
      ...optionalMap(
        context.parsed,
        "workspace-group-map",
        "workspaceGroupMap",
      ),
      ...optionalString(
        context.parsed,
        "workspace-group-prefix",
        "workspaceGroupPrefix",
      ),
      ...optionalProviderPreset(context.parsed),
    },
  };
  return ssoAdministrationUpdateSettings({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function testSsoSettings(context: AdministrationCommandContext) {
  return ssoAdministrationTestSettings({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function deprovisionOidcUser(context: AdministrationCommandContext) {
  const issuerUrl = flagValue(context.parsed.flags, "issuer-url");
  const body = {
    oidcSubject: requiredFlag(context.parsed, "oidc-subject", "subject"),
    confirmOidcSubject: requiredFlag(
      context.parsed,
      "confirm-oidc-subject",
      "confirm-subject",
    ),
    ...(issuerUrl === undefined ? {} : { issuerUrl }),
  };
  return authProviderAdministrationDeprovisionOidcUser({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function listUsers(context: AdministrationCommandContext) {
  return administrationListUsers({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function disableUser(context: AdministrationCommandContext) {
  const userId = requiredFlag(context.parsed, "user", "user-id");
  return administrationDisableUser({
    client: generatedClient(context),
    path: { userId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function listGroups(context: AdministrationCommandContext) {
  return administrationListGroups({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function createGroup(context: AdministrationCommandContext) {
  const slug = flagValue(context.parsed.flags, "slug");
  const body = {
    name: requiredFlag(context.parsed, "name"),
    ...(slug === undefined ? {} : { slug }),
  };
  return administrationCreateGroup({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function listGroupMembers(context: AdministrationCommandContext) {
  const groupId = requiredFlag(context.parsed, "group");
  return administrationListGroupMembers({
    client: generatedClient(context),
    path: { groupId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function addGroupMember(context: AdministrationCommandContext) {
  const groupId = requiredFlag(context.parsed, "group");
  const body = { userId: requiredFlag(context.parsed, "user", "user-id") };
  return administrationAddGroupMember({
    body,
    client: generatedClient(context),
    path: { groupId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function removeGroupMember(context: AdministrationCommandContext) {
  const groupId = requiredFlag(context.parsed, "group");
  const userId = requiredFlag(context.parsed, "user", "user-id");
  return administrationRemoveGroupMember({
    client: generatedClient(context),
    path: { groupId, userId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(
  context: AdministrationCommandContext,
): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function optionalString(
  parsed: ParsedArgs,
  flag: string,
  key: string,
): Record<string, string> {
  const value = flagValue(parsed.flags, flag);
  return value === undefined ? {} : { [key]: value };
}

function optionalArray(
  parsed: ParsedArgs,
  flag: string,
  key: string,
): Record<string, string[]> {
  const value = optionalCsvFlag(parsed, flag);
  return value === undefined ? {} : { [key]: value };
}

function optionalMap(
  parsed: ParsedArgs,
  flag: string,
  key: string,
): Record<string, Record<string, string>> {
  const value = optionalMappingFlag(parsed, flag);
  return value === undefined ? {} : { [key]: value };
}

function optionalProviderPreset(parsed: ParsedArgs): {
  providerPreset?: NonNullable<
    UpdateSsoSettingsRequest["oidc"]["providerPreset"]
  >;
} {
  const value = flagValue(parsed.flags, "provider-preset");
  return value === undefined
    ? {}
    : {
        providerPreset: value as NonNullable<
          UpdateSsoSettingsRequest["oidc"]["providerPreset"]
        >,
      };
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: AdministrationCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
