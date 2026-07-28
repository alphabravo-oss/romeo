import {
  localAuthGetStatus,
  type LocalAuthStatus,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getLocalAuthStatus(): Promise<LocalAuthStatus> {
  configureBrowserApiClients();
  const response = await localAuthGetStatus({ throwOnError: true });
  return response.data.data;
}
