import { createFileRoute } from "@tanstack/react-router";

import { WorkspaceShell } from "../components/WorkspaceShell";
import { localeNamespaceGroups, useLocaleNamespaces } from "../lib/i18n";

export const Route = createFileRoute("/")({
  component: ChatRoute,
});

function ChatRoute() {
  useLocaleNamespaces(localeNamespaceGroups.chat);
  return <WorkspaceShell />;
}
