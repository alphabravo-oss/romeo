import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  getRagPolicy,
  getRagPolicyChangeRequest,
  getRagPosture,
} from "./queries";

function ragOptions<T>(
  resource: string,
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
) {
  return queryOptions({
    ...serverQueryPolicy("stable", resource),
    queryKey,
    queryFn: ({ signal }) => abortableQuery(signal, queryFn),
  });
}

export const ragPolicyQueryOptions = () =>
  ragOptions("ragPolicy", appQueryKeys.ragPolicy(), getRagPolicy);
export const ragPostureQueryOptions = () =>
  ragOptions("ragPosture", appQueryKeys.ragPosture(), getRagPosture);
export const ragPolicyChangeRequestQueryOptions = () =>
  ragOptions(
    "ragPolicyChangeRequest",
    appQueryKeys.ragPolicyChangeRequest(),
    getRagPolicyChangeRequest,
  );
