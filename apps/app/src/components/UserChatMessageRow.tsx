import { Button, Textarea } from "@romeo/ui";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import GitBranch from "lucide-react/dist/esm/icons/git-branch.mjs";
import Pencil from "lucide-react/dist/esm/icons/pencil.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import User from "lucide-react/dist/esm/icons/user.mjs";
import type { ReactNode } from "react";

import type { Message } from "../features/types";
import { useLocale } from "../lib/i18n";
import { formatDateTime } from "../lib/locale-format";
import { Markdown } from "../lib/markdown";
import { Action, MessageActions } from "./ChatMessageActions";
import { MessageToolbar } from "./ChatMessageRowControls";
import { transcriptMessageDomId } from "./TranscriptWindow";
import { MessageHeading, messageHeadingId } from "./MessageHeading";

export function UserChatMessageRow(props: {
  attachments: ReactNode;
  canBranch: boolean;
  canDelete: boolean;
  canEdit: boolean;
  copied: boolean;
  editing: boolean;
  editValue: string;
  isStreaming: boolean;
  message: Message;
  positionInSet: number;
  setSize: number;
  onBranch: (messageId: string) => void;
  onCancelEdit: () => void;
  onCopy: (message: Message) => void;
  onDelete: (messageId: string) => void;
  onEditValueChange: (value: string) => void;
  onStartEdit: (message: Message) => void;
  onSubmitEdit: (messageId: string, content: string) => void;
  showMessageTimestamps: boolean;
  variantSwitcher: ReactNode;
}) {
  const { locale, t } = useLocale();
  return (
    <article
      aria-labelledby={messageHeadingId(props.message.id)}
      aria-posinset={props.positionInSet}
      aria-setsize={props.setSize}
      className="rm-message-row user"
      data-message-id={props.message.id}
      id={transcriptMessageDomId(props.message.id)}
      tabIndex={-1}
    >
      <MessageHeading
        id={props.message.id}
        position={props.positionInSet}
        user
      />
      <div className="rm-message-body">
        {props.editing ? (
          <div className="rm-message-edit">
            <Textarea
              aria-label={t("editResend")}
              autoFocus
              onChange={(event) =>
                props.onEditValueChange(event.currentTarget.value)
              }
              rows={Math.min(
                12,
                Math.max(3, props.editValue.split("\n").length),
              )}
              value={props.editValue}
            />
            <div className="rm-message-edit-actions">
              <Button onClick={props.onCancelEdit} type="button">
                {t("cancel")}
              </Button>
              <Button
                className="primary"
                disabled={
                  props.isStreaming || props.editValue.trim().length === 0
                }
                onClick={() =>
                  props.onSubmitEdit(props.message.id, props.editValue)
                }
                title={
                  props.isStreaming ? t("waitForResponse") : t("saveSubmit")
                }
                type="button"
              >
                {t("saveSubmit")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rm-message-content">
            <Markdown content={props.message.content} />
          </div>
        )}
        {props.attachments}
        {props.editing ? null : (
          <MessageToolbar
            {...(props.showMessageTimestamps
              ? { timestamp: formatDateTime(props.message.createdAt, locale) }
              : {})}
          >
            {props.variantSwitcher}
            <MessageActions>
              <Action
                label={props.copied ? t("copied") : t("copy")}
                onClick={() => props.onCopy(props.message)}
              >
                {props.copied ? <Check size={15} /> : <Copy size={15} />}
              </Action>
              {props.canEdit ? (
                <Action
                  disabled={props.isStreaming}
                  label={t("editResend")}
                  onClick={() => props.onStartEdit(props.message)}
                  title={
                    props.isStreaming ? t("waitForResponse") : t("editResend")
                  }
                >
                  <Pencil size={15} />
                </Action>
              ) : null}
              {props.canBranch ? (
                <Action
                  disabled={props.isStreaming}
                  label={t("branch")}
                  onClick={() => props.onBranch(props.message.id)}
                  title={props.isStreaming ? t("waitForResponse") : t("branch")}
                >
                  <GitBranch size={15} />
                </Action>
              ) : null}
              {props.canDelete ? (
                <Action
                  disabled={props.isStreaming}
                  label={t("deleteMessage")}
                  onClick={() => props.onDelete(props.message.id)}
                  title={
                    props.isStreaming
                      ? t("waitForResponse")
                      : t("deleteMessage")
                  }
                >
                  <Trash2 size={15} />
                </Action>
              ) : null}
            </MessageActions>
          </MessageToolbar>
        )}
      </div>
      <div className="rm-message-avatar user">
        <User aria-hidden="true" size={16} />
      </div>
    </article>
  );
}
