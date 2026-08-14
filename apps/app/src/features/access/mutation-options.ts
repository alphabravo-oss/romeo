import type { QueryKey } from "@tanstack/react-query";

import { serverMutationOptions } from "../../lib/server-mutation-options";
import type { SharePrincipal } from "./api";

export function grantResourceMutationOptions(options: {
  mutationFn: (share: SharePrincipal) => Promise<unknown>;
  queryKey: QueryKey;
}) {
  return serverMutationOptions({
    resource: "resourceGrant.create",
    mutationFn: options.mutationFn,
    invalidations: () => [{ exact: true, queryKey: options.queryKey }],
  });
}

export function revokeResourceGrantMutationOptions(options: {
  mutationFn: (grantId: string) => Promise<unknown>;
  queryKey: QueryKey;
}) {
  return serverMutationOptions({
    resource: "resourceGrant.revoke",
    mutationFn: options.mutationFn,
    invalidations: () => [{ exact: true, queryKey: options.queryKey }],
  });
}
