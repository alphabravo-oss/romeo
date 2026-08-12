import { IconButton } from "@romeo/ui";
import Clock3 from "lucide-react/dist/esm/icons/clock-3.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";

import type { QueuedChatTurn } from "../features/runs";
import { useLocale } from "../lib/i18n";

/**
 * Turns typed while the answer is still streaming, shown where they will land:
 * ghosted user bubbles at the foot of the thread. Rendered as a sibling of the
 * transcript rather than inside it, so a pending turn — which has no message id
 * and no place in the message tree — never has to be faked into ChatMessages.
 */
export function QueuedTurnGhosts({
  onCancel,
  turns,
}: {
  onCancel: (turn: QueuedChatTurn) => void;
  turns: QueuedChatTurn[];
}) {
  const { t } = useLocale();
  if (turns.length === 0) return null;
  return (
    <div aria-live="polite" className="rm-message-list rm-message-list-queued">
      {turns.map((turn) => (
        <article
          className={`rm-message-row user pending ${turn.status === "failed" ? "failed" : ""}`}
          key={turn.id}
        >
          <div className="rm-message-body">
            <div className="rm-message-content">{turn.content}</div>
            <div className="rm-message-queued-meta">
              <span>
                {turn.status === "failed" ? t("failed") : t("queued")}
              </span>
              <IconButton
                aria-label={`${t("removeQueued")}: ${turn.content}`}
                onClick={() => onCancel(turn)}
                size="sm"
                variant="ghost"
              >
                <X aria-hidden="true" size={12} />
              </IconButton>
            </div>
          </div>
          <div className="rm-message-avatar user">
            <Clock3 aria-hidden="true" size={16} />
          </div>
        </article>
      ))}
    </div>
  );
}
