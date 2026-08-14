import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getChatExperience } from "./index";

export function chatExperienceQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "chatExperience"),
    queryKey: appQueryKeys.chatExperience(),
    queryFn: ({ signal }) => abortableQuery(signal, getChatExperience),
  });
}
