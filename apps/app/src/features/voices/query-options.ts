import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { listVoices } from "./queries";

export function voicesQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "voices"),
    queryKey: appQueryKeys.voices(),
    queryFn: ({ signal }) => abortableQuery(signal, listVoices),
  });
}
