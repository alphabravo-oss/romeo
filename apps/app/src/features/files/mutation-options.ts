import * as appQueryKeys from "../../lib/app-query-keys";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  deleteFile,
  retryFileExtraction,
  retryFileLifecycle,
} from "./mutations";

export type FileLifecycleMutationInput = {
  action: "delete" | "retry_extraction" | "retry_lifecycle";
  fileId: string;
  workspaceId: string | undefined;
};

export function fileLifecycleMutationOptions() {
  return serverMutationOptions({
    resource: "file.lifecycle",
    mutationFn: (input: FileLifecycleMutationInput) => {
      if (input.action === "delete") return deleteFile(input.fileId);
      if (input.action === "retry_extraction")
        return retryFileExtraction(input.fileId);
      return retryFileLifecycle(input.fileId);
    },
    reconcile: (client, _result, input) =>
      invalidateCachedResourceExactly(
        client,
        appQueryKeys.files(input.workspaceId),
      ),
  });
}
