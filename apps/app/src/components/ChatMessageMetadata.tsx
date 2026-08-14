import { Button } from "@romeo/ui";
import Brain from "lucide-react/dist/esm/icons/brain.mjs";
import Wrench from "lucide-react/dist/esm/icons/wrench.mjs";
import { useState } from "react";

import type { SpeechArtifact } from "../features/types";
import { useLocale, type Locale, type MessageKey } from "../lib/i18n";
import { formatDateTime } from "../lib/locale-format";
import type { ChatReasoning, ChatRunWait } from "../lib/run-registry";
import type { ChatToolCall } from "../lib/run-tool-calls";
import type {
  ChatCitation,
  ChatRunActivity,
} from "./workspace-controller-types";

/**
 * Open WebUI-style status stack: the current wait/retry line plus recent run
 * activities in one compact timeline above the answer body.
 */
export function RunStatusStack({
  activities,
  wait,
  waitLabel,
}: {
  activities: ChatRunActivity[];
  wait: ChatRunWait | undefined;
  waitLabel: string | undefined;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const history = activities.slice(-6);
  const showWait =
    waitLabel !== undefined &&
    wait !== undefined &&
    wait.phase !== "streaming" &&
    !wait.hasContent;
  if (!showWait && history.length === 0) return null;

  const primaryLabel = showWait
    ? waitLabel
    : (history.at(-1)?.label ?? t("chatActivityGeneratingResponse"));
  const primaryState = showWait
    ? "active"
    : (history.at(-1)?.state ?? "active");
  const canExpand = history.length > 1 || (showWait && history.length > 0);

  return (
    <div className="rm-status-stack" aria-live="polite">
      <Button
        aria-expanded={canExpand ? expanded : undefined}
        className="rm-status-stack__primary"
        disabled={!canExpand}
        onClick={() => canExpand && setExpanded((value) => !value)}
        type="button"
        variant="ghost"
      >
        <span className={`rm-run-activity-dot ${primaryState}`} />
        <span className="rm-status-stack__label">{primaryLabel}</span>
        {canExpand ? (
          <span className="rm-status-stack__toggle">
            {expanded ? t("statusHideSteps") : t("statusShowSteps")}
          </span>
        ) : null}
      </Button>
      {expanded && history.length > 0 ? (
        <div className="rm-status-stack__history">
          {history.map((activity, index) => (
            <div
              className={`rm-run-activity ${activity.state}`}
              key={activity.id}
            >
              <span className="rm-status-stack__rail" aria-hidden="true">
                <span className={`rm-run-activity-dot ${activity.state}`} />
                {index < history.length - 1 ? (
                  <span className="rm-status-stack__line" />
                ) : null}
              </span>
              <span>{activity.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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

/**
 * A provider-designated safe reasoning summary. Collapsed by default and a
 * plain <details>, so it is keyboard operable and announced as a disclosure.
 *
 * The body is text, not markdown: even a safe summary is untrusted provider
 * output and must not create active links or rich content.
 */
export function ReasoningPanel({
  reasoning,
  streaming,
}: {
  reasoning: ChatReasoning;
  streaming: boolean;
}) {
  const { t } = useLocale();
  return (
    <details aria-live="polite" className="rm-reasoning">
      <summary>
        <Brain aria-hidden="true" size={13} />
        {streaming
          ? t("reasoningThinking")
          : t("reasoningThoughtFor", { seconds: reasoning.seconds })}
      </summary>
      <div className="rm-reasoning-text">{reasoning.text}</div>
    </details>
  );
}

const toolCallStateLabels: Record<ChatToolCall["state"], MessageKey> = {
  awaiting_approval: "chatActivityToolApprovalRequired",
  completed: "chatActivityToolCompleted",
  failed: "chatActivityToolFailed",
  requested: "toolCallRequested",
  running: "chatActivityRunningTool",
};

const toolCallDotStates: Record<
  ChatToolCall["state"],
  ChatRunActivity["state"]
> = {
  awaiting_approval: "active",
  completed: "complete",
  failed: "error",
  requested: "active",
  running: "active",
};

export function ToolCallList({ calls }: { calls: ChatToolCall[] }) {
  if (calls.length === 0) return null;
  return (
    <div className="rm-tool-calls" aria-live="polite">
      {calls.map((call) => (
        <ToolCallCard call={call} key={call.id} />
      ))}
    </div>
  );
}

/**
 * One tool call, expandable in place. Argument and result KEYS only: run event
 * data reaches every reader of the chat, and the redaction boundary that keeps
 * tool inputs and outputs off that wire is the reason this card can exist at
 * all without a policy change.
 */
function ToolCallCard({ call }: { call: ChatToolCall }) {
  const { t } = useLocale();
  return (
    <details className="rm-tool-call">
      <summary>
        <span className={`rm-run-activity ${toolCallDotStates[call.state]}`}>
          <span className="rm-run-activity-dot" />
        </span>
        <Wrench aria-hidden="true" size={13} />
        <span className="rm-tool-call-name">{call.name}</span>
        <span className="rm-tool-call-state">
          {t(toolCallStateLabels[call.state])}
        </span>
        {call.durationMs === undefined ? null : (
          <span className="rm-tool-call-duration">
            {formatToolDuration(call.durationMs)}
          </span>
        )}
      </summary>
      <dl className="rm-tool-call-detail">
        <ToolCallField
          label={t("toolCallArguments")}
          value={call.argumentKeys.join(", ")}
        />
        <ToolCallField
          label={t("toolCallResultFields")}
          value={call.outputKeys.join(", ")}
        />
        <ToolCallField label={t("toolCallRisk")} value={call.riskLevel} />
        <ToolCallField
          label={t("toolCallApproval")}
          value={
            call.approvalRequired ? t("toolCallApprovalRequired") : undefined
          }
        />
        <ToolCallField label={t("toolCallError")} value={call.errorCode} />
      </dl>
    </details>
  );
}

function ToolCallField({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  if (value === undefined || value.length === 0) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function formatToolDuration(durationMs: number): string {
  return durationMs < 1_000
    ? `${durationMs}ms`
    : `${(durationMs / 1_000).toFixed(1)}s`;
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
