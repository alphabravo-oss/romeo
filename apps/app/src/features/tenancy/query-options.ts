import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { listWorkspaces } from "./queries";

export function workspacesQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("interactive", "workspaces"),
    queryKey: appQueryKeys.workspaces(),
    queryFn: ({ signal }) => abortableQuery(signal, listWorkspaces),
  });
}
