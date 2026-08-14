import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import {
  createTenantOrganization,
  reactivateTenantOrganization,
  suspendTenantOrganization,
  updateTenantOrganization,
} from "./mutations";
import type {
  CreateTenantOrganizationRequest,
  TenantOrganizationSummary,
  TenantProvisioningResult,
  UpdateTenantOrganizationRequest,
} from "./types";

type OrganizationCatalogSnapshot = TenantOrganizationSummary[] | undefined;

async function withinCurrentSession<T>(operation: () => Promise<T>) {
  const sessionVersion = currentMutationSessionVersion();
  const result = await operation();
  if (sessionVersion !== currentMutationSessionVersion()) {
    throw new Error("The authentication session changed.");
  }
  return result;
}

function publicOrganizationSummary(
  result: TenantProvisioningResult,
): TenantOrganizationSummary {
  return {
    organization: result.organization,
    counts: result.counts,
    suspension: result.suspension,
    ...(result.deletionRequest === undefined
      ? {}
      : { deletionRequest: result.deletionRequest }),
  };
}

function updateOrganization(
  client: QueryClient,
  organizationId: string,
  update: (current: TenantOrganizationSummary) => TenantOrganizationSummary,
): void {
  client.setQueryData<TenantOrganizationSummary[]>(
    appQueryKeys.adminOrganizations(),
    (current) =>
      current?.map((entry) =>
        entry.organization.id === organizationId ? update(entry) : entry,
      ),
  );
}

function reconcileOrganization(
  client: QueryClient,
  organization: TenantOrganizationSummary,
): void {
  client.setQueryData<TenantOrganizationSummary[]>(
    appQueryKeys.adminOrganizations(),
    (current) => {
      if (current === undefined) return undefined;
      return current.some(
        (entry) => entry.organization.id === organization.organization.id,
      )
        ? current.map((entry) =>
            entry.organization.id === organization.organization.id
              ? organization
              : entry,
          )
        : [...current, organization];
    },
  );
}

async function snapshotCatalog(
  client: QueryClient,
): Promise<OrganizationCatalogSnapshot> {
  const queryKey = appQueryKeys.adminOrganizations();
  await client.cancelQueries({ exact: true, queryKey });
  return client.getQueryData<TenantOrganizationSummary[]>(queryKey);
}

function restoreCatalog(
  client: QueryClient,
  snapshot: OrganizationCatalogSnapshot,
): void {
  const queryKey = appQueryKeys.adminOrganizations();
  if (snapshot === undefined) client.removeQueries({ exact: true, queryKey });
  else client.setQueryData(queryKey, snapshot);
}

const catalogInvalidation = () => [
  { exact: true as const, queryKey: appQueryKeys.adminOrganizations() },
];

export function createTenantOrganizationMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "tenantOrganization.create",
    mutationFn: (input: CreateTenantOrganizationRequest) =>
      withinCurrentSession(() => createTenantOrganization(input)),
    reconcile: (client, result) =>
      reconcileOrganization(client, publicOrganizationSummary(result)),
    invalidations: catalogInvalidation,
  });
}

export interface UpdateTenantOrganizationInput {
  orgId: string;
  body: UpdateTenantOrganizationRequest;
}

export function updateTenantOrganizationMutationOptions() {
  return serverMutationOptions<
    TenantOrganizationSummary,
    Error,
    UpdateTenantOrganizationInput,
    OrganizationCatalogSnapshot
  >({
    resource: "tenantOrganization.update",
    mutationFn: (input) =>
      withinCurrentSession(() => updateTenantOrganization(input)),
    optimistic: {
      snapshot: snapshotCatalog,
      update: (client, input) =>
        updateOrganization(client, input.orgId, (current) => ({
          ...current,
          organization: {
            ...current.organization,
            name: input.body.name ?? current.organization.name,
            slug: input.body.slug ?? current.organization.slug,
          },
        })),
      rollback: restoreCatalog,
    },
    reconcile: reconcileOrganization,
    invalidations: catalogInvalidation,
  });
}

export interface SuspendTenantOrganizationInput {
  orgId: string;
  reasonCode: string;
}

export function suspendTenantOrganizationMutationOptions() {
  return serverMutationOptions<
    TenantOrganizationSummary,
    Error,
    SuspendTenantOrganizationInput,
    OrganizationCatalogSnapshot
  >({
    resource: "tenantOrganization.suspend",
    mutationFn: (input) =>
      withinCurrentSession(() => suspendTenantOrganization(input)),
    optimistic: {
      snapshot: snapshotCatalog,
      update: (client, input) =>
        updateOrganization(client, input.orgId, (current) => ({
          ...current,
          suspension: {
            suspended: true,
            reasonCode: input.reasonCode,
          },
        })),
      rollback: restoreCatalog,
    },
    reconcile: reconcileOrganization,
    invalidations: catalogInvalidation,
  });
}

export function reactivateTenantOrganizationMutationOptions() {
  return serverMutationOptions<
    TenantOrganizationSummary,
    Error,
    string,
    OrganizationCatalogSnapshot
  >({
    resource: "tenantOrganization.reactivate",
    mutationFn: (organizationId) =>
      withinCurrentSession(() => reactivateTenantOrganization(organizationId)),
    optimistic: {
      snapshot: snapshotCatalog,
      update: (client, organizationId) =>
        updateOrganization(client, organizationId, (current) => ({
          ...current,
          suspension: { suspended: false },
        })),
      rollback: restoreCatalog,
    },
    reconcile: reconcileOrganization,
    invalidations: catalogInvalidation,
  });
}
