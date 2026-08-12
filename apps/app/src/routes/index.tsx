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
      // Stays a replace: the agent is derived from whichever chat is open and
      // is re-announced on every chat switch, so pushing here would bury each
      // real navigation under a duplicate entry and make Back need two presses.
      onAgentSelection={(agent) =>
        void navigate({
          search: (previous) => ({ ...previous, agent }),
          replace: true,
        })
      }
      // Pushes by default, so Back and Forward walk the chats the reader
      // actually opened. Only automatic corrections ask to replace: the chat
      // row a first send just created, and a chat that vanished server-side,
      // both describe the entry the reader is already standing on.
      onChatSelection={(chat, options) =>
        void navigate({
          search: (previous) => {
            const { chat: _chat, ...rest } = previous;
            return { ...rest, ...(chat === undefined ? {} : { chat }) };
          },
          replace: options?.replace === true,
        })
      }
      {...(search.agent === undefined
        ? {}
        : { requestedAgentId: search.agent })}
      {...(search.chat === undefined ? {} : { requestedChatId: search.chat })}
    />
  );
}
