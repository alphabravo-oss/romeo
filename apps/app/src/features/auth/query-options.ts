import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getLocalAuthStatus } from "./queries";
import { getBootstrap } from "../identity";

export function localAuthStatusQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "localAuthStatus"),
    queryKey: appQueryKeys.localAuthStatus(),
    queryFn: ({ signal }) => abortableQuery(signal, getLocalAuthStatus),
  });
}

export function loginSessionQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "loginSession"),
    queryKey: appQueryKeys.loginSession(),
    queryFn: ({ signal }) => abortableQuery(signal, getBootstrap),
    retry: false,
  });
}
