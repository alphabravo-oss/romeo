import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import { triggerDirectorySync } from "./mutations";
import type { DirectorySyncRequest } from "./types";

export function directorySyncMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "directorySync.execute",
    mutationFn: async (input: DirectorySyncRequest) => {
      const sessionVersion = currentMutationSessionVersion();
      const result = await triggerDirectorySync(input);
      if (sessionVersion !== currentMutationSessionVersion()) {
        throw new Error("The authentication session changed.");
      }
      return result;
    },
    reconcile: async (client, result) => {
      if (result.mode !== "apply") return;
      await Promise.all([
        invalidateCachedResourceExactly(client, appQueryKeys.users()),
        invalidateCachedResourceExactly(client, appQueryKeys.groups()),
      ]);
    },
  });
}
