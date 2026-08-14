import { createFileRoute } from "@tanstack/react-router";

import { WorkspaceShell } from "../components/WorkspaceShell";
import { localeNamespaceGroups, useLocaleNamespaces } from "../lib/i18n";
import modelPickerCss from "../styles/app-model-picker.css?url";
import {
  selectBranchSearch,
  selectChatSearch,
  validateChatRouteSearch,
} from "../lib/chat-route-search";
import { prefetchPrimaryRouteData } from "../lib/route-data";

export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ rel: "stylesheet", href: modelPickerCss }],
  }),
  validateSearch: validateChatRouteSearch,
  loaderDeps: ({ search }) => ({
    chatId: search.chat,
    workspaceId: search.workspace,
  }),
  loader: ({ cause, context, deps }) =>
    prefetchPrimaryRouteData(
      "chat",
      context,
      cause === "preload" ? "intent" : "navigation",
      deps,
    ),
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
          search: (previous) => selectChatSearch(previous, chat),
          replace: options?.replace === true,
        })
      }
      onBranchSelection={(leaf, options) =>
        void navigate({
          search: (previous) => selectBranchSearch(previous, leaf),
          replace: options?.replace === true,
        })
      }
      {...(search.agent === undefined
        ? {}
        : { requestedAgentId: search.agent })}
      {...(search.chat === undefined ? {} : { requestedChatId: search.chat })}
      {...(search.leaf === undefined
        ? {}
        : { requestedLeafMessageId: search.leaf })}
    />
  );
}
