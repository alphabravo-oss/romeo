import { useLocale } from "../lib/i18n";
import { transcriptMessageHeadingDomId } from "./TranscriptWindow";

export const messageHeadingId = transcriptMessageHeadingDomId;

export function MessageHeading({
  id,
  position,
  user = false,
}: {
  id: string;
  position: number;
  user?: boolean;
}) {
  const { t } = useLocale();
  return (
    <h2 className="sr-only" id={messageHeadingId(id)}>
      {t(user ? "userMessageHeading" : "assistantMessageHeading", { position })}
    </h2>
  );
}
