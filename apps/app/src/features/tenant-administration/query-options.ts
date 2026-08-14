import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { listTenantOrganizations } from "./queries";

export function tenantOrganizationsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("interactive", "adminOrganizations"),
    queryKey: appQueryKeys.adminOrganizations(),
    queryFn: ({ signal }) => abortableQuery(signal, listTenantOrganizations),
  });
}
