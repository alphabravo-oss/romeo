import { Button } from "@romeo/ui";
import Star from "lucide-react/dist/esm/icons/star.mjs";

import { chatExportUrl } from "../features";
import type { Chat } from "../features/types";
import { useLocale } from "../lib/i18n";
import { OverflowMenu } from "./OverflowMenu";
import type { WorkspaceNavDialog } from "./WorkspaceNavDialogs";

export interface WorkspaceChatNavItemProps {
  active: boolean;
  chat: Chat;
  folders: Array<{ id: string; name: string }>;
  onDelete: () => void;
  onDialog: (dialog: WorkspaceNavDialog) => void;
  onExportMarkdown: () => void;
  onSelect: () => void;
  onTogglePin: () => void;
  pinned: boolean;
}

export function WorkspaceChatNavItem(props: WorkspaceChatNavItemProps) {
  const { t } = useLocale();
  return (
    <div
      className={`rm-sidebar-item ${props.active ? "active" : ""}`}
      data-chat-id={props.chat.id}
    >
      <Button
        aria-current={props.active ? "page" : undefined}
        className="rm-sidebar-item-label truncate"
        onClick={props.onSelect}
        type="button"
      >
        {props.pinned ? (
          <Star
            aria-hidden="true"
            className="rm-chat-pin"
            fill="currentColor"
            size={11}
          />
        ) : null}
        {props.chat.title}
      </Button>
      <OverflowMenu
        items={[
          {
            label: props.pinned ? t("unpin") : t("pin"),
            onClick: props.onTogglePin,
          },
          {
            label: t("rename"),
            onClick: () => props.onDialog({ kind: "rename", chat: props.chat }),
          },
          {
            label: t("share"),
            onClick: () => props.onDialog({ kind: "share", chat: props.chat }),
          },
          { label: t("exportMarkdown"), onClick: props.onExportMarkdown },
          {
            label: t("exportJson"),
            onClick: () =>
              window.open(
                chatExportUrl(props.chat.id),
                "_blank",
                "noopener,noreferrer",
              ),
          },
          {
            label: t("exportHtml"),
            onClick: () =>
              window.open(
                chatExportUrl(props.chat.id, "html"),
                "_blank",
                "noopener,noreferrer",
              ),
          },
          {
            label: t("addTag"),
            onClick: () => props.onDialog({ kind: "tag", chat: props.chat }),
          },
          ...(props.folders.length === 0
            ? []
            : [
                {
                  label: t("addToFolder"),
                  onClick: () =>
                    props.onDialog({
                      kind: "move",
                      chat: props.chat,
                      initialFolderId: props.folders[0]!.id,
                    }),
                },
              ]),
          { label: t("delete"), onClick: props.onDelete, tone: "danger" },
        ]}
        label={`${t("chatActionsFor")} ${props.chat.title}`}
        orientation="vertical"
      />
    </div>
  );
}
