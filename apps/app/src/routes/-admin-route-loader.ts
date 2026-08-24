import type { RomeoRouterContext } from "../lib/router-context";
import { ADMIN_META } from "../components/admin-console-navigation";
import {
  localeNamespacesForAdminSection,
  preloadRouteLocaleNamespaces,
} from "../lib/i18n";
import { prefetchPrimaryRouteData } from "../lib/route-data";
import { resolveSectionKey } from "../lib/section-routing";

export async function loadAdminRouteData({
  abortController,
  cause,
  context,
  deps,
}: {
  abortController: AbortController;
  cause: string;
  context: RomeoRouterContext;
  deps: { section?: string; workspaceId?: string };
}) {
  const [selection] = await Promise.all([
    prefetchPrimaryRouteData(
      "admin",
      context,
      cause === "preload" ? "intent" : "navigation",
      deps,
      abortController.signal,
    ),
    preloadRouteLocaleNamespaces(
      context.locale,
      localeNamespacesForAdminSection(
        resolveSectionKey(deps.section, ADMIN_META, "overview"),
      ),
    ),
  ]);
  return selection;
}
