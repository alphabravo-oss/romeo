import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { listDeviceAuthorizations } from "./queries";

export function deviceAuthorizationsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("interactive", "deviceAuthorizations"),
    queryKey: appQueryKeys.deviceAuthorizations(),
    queryFn: ({ signal }) => abortableQuery(signal, listDeviceAuthorizations),
  });
}
