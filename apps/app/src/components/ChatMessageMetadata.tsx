import type { SpeechArtifact } from "../features/types";
import { useLocale, type Locale } from "../lib/i18n";
import { formatDateTime } from "../lib/locale-format";
import type { ChatCitation, ChatRunActivity } from "./useWorkspaceController";

export function RunActivityList({
  activities,
}: {
  activities: ChatRunActivity[];
}) {
  if (activities.length === 0) return null;
  return (
    <div className="rm-run-activities" aria-live="polite">
      {activities.slice(-4).map((activity) => (
        <div className={`rm-run-activity ${activity.state}`} key={activity.id}>
          <span className="rm-run-activity-dot" /> {activity.label}
        </div>
      ))}
    </div>
  );
}

export function CitationList({ citations }: { citations: ChatCitation[] }) {
  const { locale, t } = useLocale();
  return (
    <details className="rm-citations">
      <summary>
        {citations.length}{" "}
        {citations.length === 1 ? t("citationSource") : t("citationSources")}
      </summary>
      <ol>
        {citations.map((citation) => (
          <li key={citation.chunkId}>
            {citation.sourceUri ? (
              <a href={citation.sourceUri} rel="noreferrer" target="_blank">
                <strong>{citation.title}</strong>
              </a>
            ) : (
              <strong>{citation.title}</strong>
            )}
            <span suppressHydrationWarning>
              {citation.sourceUri
                ? citationHost(citation.sourceUri, t("citationSourceLink"))
                : `${citation.documentId} · ${citation.chunkId}`}
              {citation.provider ? ` · ${citation.provider}` : ""}
              {citation.publishedAt
                ? ` · ${t("citationPublished")} ${formatCitationDate(citation.publishedAt, locale)}`
                : ""}
              {citation.accessedAt
                ? ` · ${t("citationAccessed")} ${formatCitationDate(citation.accessedAt, locale)}`
                : ""}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function citationHost(value: string, fallback: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return fallback;
  }
}

function formatCitationDate(value: string, locale: Locale): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? formatDateTime(timestamp, locale) : value;
}

export function formatSpeechArtifact(artifact: SpeechArtifact): string {
  if (artifact.durationMs === undefined) return artifact.contentType;
  return `${artifact.contentType} · ${Math.round(artifact.durationMs / 1_000)}s`;
}
