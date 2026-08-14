import {
  administrationListGroupsOptions,
  administrationListUsersOptions,
  capabilitiesExplainAdminOptions,
  capabilitiesGetAdminOverviewOptions,
  capabilitiesGetAssignmentHistoryOptions,
  capabilitiesGetPlatformPostureOptions,
  type CapabilityDefinition,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";

export type CapabilityScope = {
  scopeType: "organization" | "workspace" | "agent" | "group" | "user";
  scopeId: string;
  workspaceId: string;
};

export function capabilityAssignmentScope(scope: CapabilityScope): {
  scopeType: CapabilityScope["scopeType"];
  scopeId: string;
} {
  return { scopeType: scope.scopeType, scopeId: scope.scopeId };
}

export function capabilityAdminGroupsQueryOptions(
  client: GeneratedQueryClient,
) {
  return {
    ...administrationListGroupsOptions({ client }),
    select: (
      response: Awaited<
        ReturnType<
          NonNullable<
            ReturnType<typeof administrationListGroupsOptions>["queryFn"]
          >
        >
      >,
    ) => response.data,
  };
}

export function capabilityAdminUsersQueryOptions(client: GeneratedQueryClient) {
  return {
    ...administrationListUsersOptions({
      client,
      query: { limit: 100, offset: 0, sort: "name", direction: "asc" },
    }),
    select: (
      response: Awaited<
        ReturnType<
          NonNullable<
            ReturnType<typeof administrationListUsersOptions>["queryFn"]
          >
        >
      >,
    ) => response.data,
  };
}

export function capabilityOverviewQueryOptions(
  scope: CapabilityScope,
  client: GeneratedQueryClient,
) {
  return {
    ...capabilitiesGetAdminOverviewOptions({
      client,
      query: scope,
    }),
    select: (
      response: Awaited<
        ReturnType<
          NonNullable<
            ReturnType<typeof capabilitiesGetAdminOverviewOptions>["queryFn"]
          >
        >
      >,
    ) => response.data,
  };
}

export function capabilityPlatformPostureQueryOptions(
  client: GeneratedQueryClient,
) {
  return {
    ...capabilitiesGetPlatformPostureOptions({ client }),
    select: (
      response: Awaited<
        ReturnType<
          NonNullable<
            ReturnType<typeof capabilitiesGetPlatformPostureOptions>["queryFn"]
          >
        >
      >,
    ) => response.data,
  };
}

export function capabilityHistoryQueryOptions(
  scope: CapabilityScope,
  capabilityId: CapabilityDefinition["id"],
  client: GeneratedQueryClient,
) {
  return {
    ...capabilitiesGetAssignmentHistoryOptions({
      client,
      path: { capabilityId },
      query: capabilityAssignmentScope(scope),
    }),
    enabled: false,
    select: (
      response: Awaited<
        ReturnType<
          NonNullable<
            ReturnType<
              typeof capabilitiesGetAssignmentHistoryOptions
            >["queryFn"]
          >
        >
      >,
    ) => response.data,
  };
}

export function capabilityExplainQueryOptions(
  scope: CapabilityScope,
  capabilityId: CapabilityDefinition["id"],
  client: GeneratedQueryClient,
) {
  return {
    ...capabilitiesExplainAdminOptions({
      client,
      path: { capabilityId },
      query: scope,
    }),
    enabled: false,
    select: (
      response: Awaited<
        ReturnType<
          NonNullable<
            ReturnType<typeof capabilitiesExplainAdminOptions>["queryFn"]
          >
        >
      >,
    ) => response.data,
  };
}
