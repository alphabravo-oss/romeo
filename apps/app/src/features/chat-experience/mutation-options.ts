import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import { updateChatExperience, type ChatExperience } from "./index";

export function updateChatExperienceMutationOptions() {
  return serverMutationOptions({
    resource: "chatExperience.update",
    mutationFn: (input: ChatExperience) => updateChatExperience(input),
    reconcile: (client, settings) => {
      client.setQueryData(appQueryKeys.chatExperience(), settings);
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.chatExperience() },
    ],
  });
}
