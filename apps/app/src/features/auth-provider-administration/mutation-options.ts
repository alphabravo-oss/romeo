import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import {
  deprovisionSsoOidcUser,
  testAuthProviderConnection,
  updateAuthProviderSettings,
} from "./mutations";

export function updateAuthProviderSettingsMutationOptions() {
  return serverMutationOptions({
    resource: "authProvider.settings.update",
    mutationFn: updateAuthProviderSettings,
    invalidations: () => [
      {
        exact: true,
        queryKey: appQueryKeys.authProviderSettings(),
      },
    ],
  });
}

export function testAuthProviderConnectionMutationOptions() {
  return serverMutationOptions({
    resource: "authProvider.connection.test",
    mutationFn: testAuthProviderConnection,
  });
}

export function deprovisionSsoOidcUserMutationOptions() {
  return serverMutationOptions({
    resource: "authProvider.oidcUser.deprovision",
    mutationFn: deprovisionSsoOidcUser,
  });
}
