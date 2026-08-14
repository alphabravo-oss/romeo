import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import type { QueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import type { Locale } from "./i18n";

export interface RomeoRouterContext {
  apiClient: GeneratedQueryClient;
  locale: Locale;
  queryClient: QueryClient;
}

export function useRouterApiClient(): GeneratedQueryClient {
  return useRouter().options.context.apiClient;
}
