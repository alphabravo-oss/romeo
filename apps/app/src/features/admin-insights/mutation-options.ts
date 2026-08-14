import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import { simulateAbuseControls, updateAbuseControls } from "./mutations";
import type {
  AbuseControlPolicyReport,
  SimulateAbuseControlPolicyRequest,
  UpdateAbuseControlPolicyRequest,
} from "./types";

type AbuseControlSnapshot = AbuseControlPolicyReport | undefined;

async function withinCurrentSession<T>(operation: () => Promise<T>) {
  const sessionVersion = currentMutationSessionVersion();
  const result = await operation();
  if (sessionVersion !== currentMutationSessionVersion()) {
    throw new Error("The authentication session changed.");
  }
  return result;
}

function optimisticSuspension(
  current: AbuseControlPolicyReport["suspension"],
  input: NonNullable<UpdateAbuseControlPolicyRequest["suspension"]>,
): AbuseControlPolicyReport["suspension"] {
  const next = {
    ...current,
    ...(input.suspended === undefined ? {} : { suspended: input.suspended }),
  };
  if (input.reasonCode === null) {
    const { reasonCode: _reasonCode, ...withoutReason } = next;
    return withoutReason;
  }
  return input.reasonCode === undefined
    ? next
    : { ...next, reasonCode: input.reasonCode };
}

function updateCachedPolicy(
  client: QueryClient,
  input: UpdateAbuseControlPolicyRequest,
): void {
  client.setQueryData<AbuseControlPolicyReport>(
    appQueryKeys.abuseControls(),
    (current) =>
      current === undefined
        ? undefined
        : {
            ...current,
            suspension:
              input.suspension === undefined
                ? current.suspension
                : optimisticSuspension(current.suspension, input.suspension),
            entitlements:
              input.entitlements === undefined
                ? current.entitlements
                : { ...current.entitlements, ...input.entitlements },
            killSwitches:
              input.killSwitches === undefined
                ? current.killSwitches
                : { ...current.killSwitches, ...input.killSwitches },
          },
  );
}

function restorePolicy(client: QueryClient, snapshot: AbuseControlSnapshot) {
  const queryKey = appQueryKeys.abuseControls();
  if (snapshot === undefined) client.removeQueries({ exact: true, queryKey });
  else client.setQueryData(queryKey, snapshot);
}

export function updateAbuseControlsMutationOptions() {
  const queryKey = appQueryKeys.abuseControls();
  return serverMutationOptions<
    AbuseControlPolicyReport,
    Error,
    UpdateAbuseControlPolicyRequest,
    AbuseControlSnapshot
  >({
    resource: "abuseControl.policy.update",
    mutationFn: (input) =>
      withinCurrentSession(() => updateAbuseControls(input)),
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<AbuseControlPolicyReport>(queryKey);
      },
      update: updateCachedPolicy,
      rollback: restorePolicy,
    },
    reconcile: (client, report) => {
      client.setQueryData(queryKey, report);
    },
    invalidations: () => [{ exact: true, queryKey }],
  });
}

export function simulateAbuseControlsMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "abuseControl.policy.simulate",
    mutationFn: (input: SimulateAbuseControlPolicyRequest) =>
      withinCurrentSession(() => simulateAbuseControls(input)),
  });
}
