import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import type { ReactNode } from "react";

import type { ChatRunWait } from "../lib/run-registry";
import type { MessageKey } from "../lib/i18n";
import { useLocale } from "../lib/i18n";
import { Action } from "./ChatMessageActions";

export function waitStatusLabel(
  wait: ChatRunWait | undefined,
  t: (
    key: MessageKey,
    values?: Record<string, boolean | number | string>,
  ) => string,
): string {
  if (wait === undefined) return t("chatActivityGeneratingResponse");
  if (wait.phase === "reconnecting") return t("streamReconnecting");
  const timeoutSeconds =
    wait.streamTimeoutMs === undefined
      ? undefined
      : Math.max(1, Math.round(wait.streamTimeoutMs / 1_000));
  if (wait.phase === "streaming") return t("chatActivityGeneratingResponse");
  if (wait.phase === "retrying") {
    return timeoutSeconds === undefined
      ? t("modelWaitRetrying", {
          attempt: wait.attempt,
          maxAttempts: wait.maxAttempts,
          seconds: wait.elapsedSeconds,
        })
      : t("modelWaitRetryingBudget", {
          attempt: wait.attempt,
          maxAttempts: wait.maxAttempts,
          seconds: wait.elapsedSeconds,
          timeout: timeoutSeconds,
        });
  }
  return timeoutSeconds === undefined
    ? t("modelWaitElapsed", { seconds: wait.elapsedSeconds })
    : t("modelWaitElapsedBudget", {
        seconds: wait.elapsedSeconds,
        timeout: timeoutSeconds,
      });
}

export function MessageToolbar({
  children,
  timestamp,
}: {
  children?: ReactNode;
  timestamp?: string;
}) {
  return (
    <div className="rm-message-toolbar">
      <div className="rm-message-toolbar__controls">{children}</div>
      {timestamp === undefined ? null : (
        <span className="rm-message-meta" suppressHydrationWarning>
          {timestamp}
        </span>
      )}
    </div>
  );
}

export function VariantSwitcher(props: {
  disabled: boolean;
  index: number;
  nextId: string | undefined;
  onSelect: (messageId: string) => void;
  previousId: string | undefined;
  total: number;
}) {
  const { t } = useLocale();
  return (
    <div className="rm-message-variants">
      <Action
        disabled={props.disabled || props.previousId === undefined}
        label={t("previousVariant")}
        onClick={() =>
          props.previousId !== undefined && props.onSelect(props.previousId)
        }
      >
        <ChevronLeft size={14} />
      </Action>
      <span className="rm-message-variant-count">
        {props.index + 1} / {props.total}
      </span>
      <Action
        disabled={props.disabled || props.nextId === undefined}
        label={t("nextVariant")}
        onClick={() =>
          props.nextId !== undefined && props.onSelect(props.nextId)
        }
      >
        <ChevronRight size={14} />
      </Action>
    </div>
  );
}
