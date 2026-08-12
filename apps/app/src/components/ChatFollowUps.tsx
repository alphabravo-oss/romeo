import { Button } from "@romeo/ui";
import { useMemo } from "react";

import { useLocale } from "../lib/i18n";
import { suggestFollowUps } from "./chat-follow-ups";

export function ChatFollowUps({
  assistantContent,
  disabled,
  onSelect,
}: {
  assistantContent: string;
  disabled: boolean;
  onSelect: (prompt: string) => void;
}) {
  const { t } = useLocale();
  const followUps = useMemo(
    () =>
      suggestFollowUps({
        assistantContent,
        labels: {
          explainSimpler: t("followUpExplainSimpler"),
          giveExample: t("followUpGiveExample"),
          makeShorter: t("followUpMakeShorter"),
          goDeeper: t("followUpGoDeeper"),
          explainCode: t("followUpExplainCode"),
          addTests: t("followUpAddTests"),
          tradeoffs: t("followUpTradeoffs"),
        },
      }),
    [assistantContent, t],
  );
  if (followUps.length === 0) return null;

  return (
    <div className="rm-follow-ups" aria-label={t("followUps")}>
      <div className="rm-follow-ups__label">{t("followUps")}</div>
      <div className="rm-follow-ups__list">
        {followUps.map((item) => (
          <Button
            className="rm-follow-up"
            disabled={disabled}
            key={item.label}
            onClick={() => onSelect(item.prompt)}
            title={item.prompt}
            type="button"
          >
            {item.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
