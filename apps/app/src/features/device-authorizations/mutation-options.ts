import type {
  CreateDeviceAuthorizationRequest,
  CreatedDeviceAuthorization,
  DeviceAuthorization,
} from "@romeo/api-client/generated/sdk";
import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  createDeviceAuthorization,
  revokeDeviceAuthorization,
} from "./mutations";

type AuthorizationList = DeviceAuthorization[] | undefined;

function restoreAuthorizations(
  client: QueryClient,
  snapshot: AuthorizationList,
): void {
  const queryKey = appQueryKeys.deviceAuthorizations();
  if (snapshot === undefined) client.removeQueries({ exact: true, queryKey });
  else client.setQueryData(queryKey, snapshot);
}

function upsertAuthorization(
  client: QueryClient,
  authorization: DeviceAuthorization,
): void {
  client.setQueryData<DeviceAuthorization[]>(
    appQueryKeys.deviceAuthorizations(),
    (current) => {
      if (current === undefined) return undefined;
      return current.some((entry) => entry.id === authorization.id)
        ? current.map((entry) =>
            entry.id === authorization.id ? authorization : entry,
          )
        : [...current, authorization];
    },
  );
}

export function createDeviceAuthorizationMutationOptions() {
  const queryKey = appQueryKeys.deviceAuthorizations();
  return serverMutationOptions<
    CreatedDeviceAuthorization,
    Error,
    CreateDeviceAuthorizationRequest
  >({
    ephemeral: true,
    resource: "deviceAuthorization.create",
    mutationFn: async (input) => {
      const sessionVersion = currentMutationSessionVersion();
      const created = await createDeviceAuthorization(input);
      if (sessionVersion !== currentMutationSessionVersion()) {
        throw new Error("The authentication session changed.");
      }
      return created;
    },
    reconcile: async (client, created) => {
      upsertAuthorization(client, created.authorization);
      await invalidateCachedResourceExactly(client, appQueryKeys.tablePages());
    },
    invalidations: () => [{ exact: true, queryKey }],
  });
}

export function revokeDeviceAuthorizationMutationOptions() {
  const queryKey = appQueryKeys.deviceAuthorizations();
  return serverMutationOptions<
    DeviceAuthorization,
    Error,
    string,
    AuthorizationList
  >({
    resource: "deviceAuthorization.revoke",
    mutationFn: revokeDeviceAuthorization,
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<DeviceAuthorization[]>(queryKey);
      },
      update: (client, authorizationId) => {
        client.setQueryData<DeviceAuthorization[]>(queryKey, (current) =>
          current?.map((authorization) =>
            authorization.id === authorizationId
              ? { ...authorization, revokedAt: new Date().toISOString() }
              : authorization,
          ),
        );
      },
      rollback: (client, snapshot) => restoreAuthorizations(client, snapshot),
    },
    reconcile: async (client, authorization) => {
      upsertAuthorization(client, authorization);
      await invalidateCachedResourceExactly(client, appQueryKeys.tablePages());
    },
    invalidations: () => [{ exact: true, queryKey }],
  });
}
