import { createFileRoute } from "@tanstack/react-router";

import { WorkspaceShell } from "../components/WorkspaceShell";
import { localeNamespaceGroups, useLocaleNamespaces } from "../lib/i18n";
import modelPickerCss from "../styles/app-model-picker.css?url";

export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ rel: "stylesheet", href: modelPickerCss }],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { agent?: string; chat?: string } => ({
    ...(typeof search.agent === "string" ? { agent: search.agent } : {}),
    ...(typeof search.chat === "string" ? { chat: search.chat } : {}),
  }),
  component: ChatRoute,
});

function ChatRoute() {
  useLocaleNamespaces(localeNamespaceGroups.chat);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <WorkspaceShell
      onAgentSelection={(agent) =>
        void navigate({
          search: (previous) => ({ ...previous, agent }),
          replace: true,
        })
      }
      onChatSelection={(chat) =>
        void navigate({
          search: (previous) => {
            const { chat: _chat, ...rest } = previous;
            return { ...rest, ...(chat === undefined ? {} : { chat }) };
          },
          replace: true,
        })
      }
      {...(search.agent === undefined
        ? {}
        : { requestedAgentId: search.agent })}
      {...(search.chat === undefined ? {} : { requestedChatId: search.chat })}
    />
  );
}
