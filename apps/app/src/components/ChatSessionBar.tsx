import Clock3 from "lucide-react/dist/esm/icons/clock-3.mjs";
import Link2 from "lucide-react/dist/esm/icons/link-2.mjs";
import Share2 from "lucide-react/dist/esm/icons/share-2.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import { Button } from "@romeo/ui";

import { chatExportUrl } from "../features";
import { useLocale } from "../lib/i18n";
import {
  chatSensitivity,
  parseBranchOrigin,
  readBranchOrigin,
  type ChatSensitivity,
} from "./chat-enterprise";
import { OverflowMenu } from "./OverflowMenu";

/**
 * Sticky chrome above an in-progress chat: identity, model, sensitivity badge,
 * branch origin, and first-class share/export actions.
 */
export function ChatSessionBar({
  chatId,
  chatTitle,
  isTemporaryChat,
  legalHoldUntil,
  modelDisplayName,
  onExportMarkdown,
  onOpenSourceChat,
  onShare,
}: {
  chatId: string | undefined;
  /** Used only to recover a "Branch of …" origin when localStorage is empty. */
  chatTitle: string | undefined;
  isTemporaryChat: boolean;
  legalHoldUntil?: string | undefined;
  modelDisplayName: string | undefined;
  onExportMarkdown: (() => void) | undefined;
  onOpenSourceChat?: ((sourceChatId: string) => void) | undefined;
  onShare: (() => void) | undefined;
}) {
  const { t } = useLocale();
  const title = chatTitle?.trim() || t("newChat");
  const canPort = chatId !== undefined;
  const sensitivity = chatSensitivity({
    temporary: isTemporaryChat,
    ...(legalHoldUntil === undefined ? {} : { legalHoldUntil }),
  });
  const storedOrigin = chatId === undefined ? null : readBranchOrigin(chatId);
  const titleOrigin = parseBranchOrigin(title);
  const branchOrigin =
    storedOrigin ??
    (titleOrigin === null
      ? null
      : {
          sourceChatId: undefined as string | undefined,
          sourceTitle: titleOrigin.sourceTitle,
        });

  return (
    <div className="rm-chat-session-bar">
      <div className="rm-chat-session-bar__fade" aria-hidden="true" />
      <div className="rm-chat-session-bar__inner">
        <div className="rm-chat-session-bar__copy">
          <div className="rm-chat-session-bar__meta">
            {modelDisplayName === undefined ? null : (
              <span
                className="rm-chat-session-bar__chip"
                title={modelDisplayName}
              >
                {modelDisplayName}
              </span>
            )}
            <SensitivityBadge sensitivity={sensitivity} t={t} />
            {branchOrigin === null ? null : (
              <span className="rm-chat-session-bar__origin" role="status">
                <Link2 aria-hidden="true" size={12} />
                {branchOrigin.sourceChatId !== undefined &&
                onOpenSourceChat !== undefined ? (
                  <Button
                    className="rm-chat-session-bar__origin-link"
                    onClick={() => onOpenSourceChat(branchOrigin.sourceChatId!)}
                    type="button"
                    variant="ghost"
                  >
                    {t("branchedFrom", { title: branchOrigin.sourceTitle })}
                  </Button>
                ) : (
                  <span>
                    {t("branchedFrom", { title: branchOrigin.sourceTitle })}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        {canPort ? (
          <div className="rm-chat-session-bar__actions">
            {onShare === undefined ? null : (
              <Button
                aria-label={t("share")}
                className="rm-chat-session-bar__action"
                onClick={onShare}
                title={t("share")}
                type="button"
                variant="ghost"
              >
                <Share2 aria-hidden="true" size={15} />
              </Button>
            )}
            <OverflowMenu
              items={[
                ...(onExportMarkdown === undefined
                  ? []
                  : [
                      {
                        label: t("exportMarkdown"),
                        onClick: onExportMarkdown,
                      },
                    ]),
                {
                  label: t("exportJson"),
                  onClick: () =>
                    window.open(
                      chatExportUrl(chatId),
                      "_blank",
                      "noopener,noreferrer",
                    ),
                },
                {
                  label: t("exportHtml"),
                  onClick: () =>
                    window.open(
                      chatExportUrl(chatId, "html"),
                      "_blank",
                      "noopener,noreferrer",
                    ),
                },
              ]}
              label={t("exportChat")}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SensitivityBadge({
  sensitivity,
  t,
}: {
  sensitivity: ChatSensitivity;
  t: (key: import("../lib/i18n").MessageKey) => string;
}) {
  if (sensitivity.kind === "temporary") {
    return (
      <span className="rm-chat-session-bar__temp" role="status">
        <Clock3 aria-hidden="true" size={12} />
        {t("temporaryChat")}
      </span>
    );
  }
  if (sensitivity.kind === "legal_hold") {
    return (
      <span className="rm-chat-session-bar__hold" role="status">
        <Shield aria-hidden="true" size={12} />
        {t("legalHoldBadge")}
      </span>
    );
  }
  return (
    <span className="rm-chat-session-bar__retained" role="status">
      {t("retainedChat")}
    </span>
  );
}
