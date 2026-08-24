import { Button } from "@romeo/ui";
import { Link } from "@tanstack/react-router";

import type { KnowledgeIngestReadiness } from "../features/knowledge";
import { useLocale, type MessageKey } from "../lib/i18n";

export function knowledgeIngestBlockedMessageKey(
  reason: KnowledgeIngestReadiness["reason"],
): MessageKey {
  return reason === "tiers_disabled"
    ? "knowledgeIngestBlockedTiers"
    : reason === "vector_unconfigured"
      ? "knowledgeIngestBlockedVector"
      : "knowledgeIngestBlockedEmbedding";
}

export function KnowledgeIngestNotice({
  isAdmin,
  readiness,
}: {
  isAdmin: boolean;
  readiness: KnowledgeIngestReadiness | undefined;
}) {
  const { t } = useLocale();
  if (readiness === undefined || readiness.ready) return null;
  const message = t(knowledgeIngestBlockedMessageKey(readiness.reason));
  // A blocked capability is a warning, not a neutral panel. The generic
  // bordered box was being flattened by the console's card rules into two
  // stray hairlines at an arbitrary width.
  return (
    <div className="rm-attention-note" role="status">
      <p>{message}</p>
      {isAdmin ? (
        <Button asChild className="w-fit" variant="secondary">
          <Link
            preload={false}
            search={(previous) => ({ ...previous, section: "rag" })}
            to="/admin"
          >
            {t("knowledgeIngestOpenRag")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
