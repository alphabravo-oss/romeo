import {
  interfacePreferencesGetCurrent,
  interfacePreferencesUpdateCurrent,
  type InterfacePreferences,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export type { InterfacePreferences };

export async function getServerInterfacePreferences(): Promise<InterfacePreferences> {
  configureBrowserApiClients();
  const response = await interfacePreferencesGetCurrent({ throwOnError: true });
  return response.data.data;
}

export async function updateServerInterfacePreferences(
  input: Partial<InterfacePreferences>,
): Promise<InterfacePreferences> {
  configureBrowserApiClients();
  const response = await interfacePreferencesUpdateCurrent({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
