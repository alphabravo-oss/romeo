import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getAuthProviderCatalog, getAuthProviderSettings } from "./queries";

export function authProviderCatalogQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "authProviderCatalog"),
    queryKey: appQueryKeys.authProviderCatalog(),
    queryFn: ({ signal }) => abortableQuery(signal, getAuthProviderCatalog),
  });
}

export function authProviderSettingsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "authProviderSettings"),
    queryKey: appQueryKeys.authProviderSettings(),
    queryFn: ({ signal }) => abortableQuery(signal, getAuthProviderSettings),
  });
}
