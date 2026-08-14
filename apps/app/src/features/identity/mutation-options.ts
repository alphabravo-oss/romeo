import { apiQueryKeys } from "../../lib/api-query-options";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import { updateMyProfile } from "./index";

export interface UpdateMyProfileInput {
  email?: string;
  name?: string;
}

export function updateMyProfileMutationOptions() {
  return serverMutationOptions({
    resource: "identity.profile.update",
    mutationFn: (input: UpdateMyProfileInput) => updateMyProfile(input),
    invalidations: () => [{ exact: true, queryKey: apiQueryKeys.bootstrap() }],
  });
}
