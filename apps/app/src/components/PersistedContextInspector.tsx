import type { PersistedRunContext } from "../lib/persisted-run-context-query";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime, LocalizedNumber } from "../lib/locale-format";

export function PersistedContextInspector({
  context,
}: {
  context: PersistedRunContext;
}) {
  const { t } = useLocale();
  return (
    <div className="rm-context-body">
      <section aria-labelledby="context-run-heading">
        <h3 id="context-run-heading">{t("contextRunProvenance")}</h3>
        <dl className="rm-context-stats">
          <Entry label={t("contextRunId")} value={context.run.id} />
          <Entry label={t("contextAgentId")} value={context.run.agentId} />
          <Entry
            label={t("contextSelectedModel")}
            value={context.model.displayName ?? context.model.id}
          />
          <Entry
            label={t("contextSelectedProvider")}
            value={context.provider.displayName ?? context.provider.id}
          />
          <Entry label={t("contextRunStatus")} value={context.run.status} />
          <Entry
            label={t("contextAgentVersion")}
            value={context.run.agentVersionId}
          />
          <Entry
            label={t("contextTranscriptVersion")}
            value={context.branch.currentTranscriptVersion}
          />
          <Entry
            label={t("contextInputMessageId")}
            value={context.branch.inputMessageId ?? t("none")}
          />
          <Entry
            label={t("contextParentMessageId")}
            value={context.branch.parentMessageId ?? t("none")}
          />
          <div>
            <dt>{t("contextVisibleMessageCount")}</dt>
            <dd>
              <LocalizedNumber value={context.branch.visibleMessageCount} />
            </dd>
          </div>
          <div>
            <dt>{t("contextRunStarted")}</dt>
            <dd>
              <LocalizedDateTime value={context.run.createdAt} />
            </dd>
          </div>
        </dl>
        {!context.model.available || !context.provider.available ? (
          <p className="rm-context-notice">{t("contextResourceUnavailable")}</p>
        ) : null}
      </section>

      <section aria-labelledby="context-messages-heading">
        <h3 id="context-messages-heading">{t("contextRecentMessages")}</h3>
        {context.messages.length === 0 ? (
          <p>{t("contextNoVisibleMessages")}</p>
        ) : (
          context.messages.map((message) => (
            <details key={message.id}>
              <summary>
                {message.role === "user"
                  ? t("contextUserMessage")
                  : t("contextAssistantMessage")}{" "}
                · <LocalizedDateTime value={message.createdAt} />
              </summary>
              <pre>{message.content}</pre>
              {message.contentTruncated ? (
                <p className="rm-context-notice">
                  {t("contextMessageTruncated")}
                </p>
              ) : null}
            </details>
          ))
        )}
      </section>

      <section aria-labelledby="context-sources-heading">
        <h3 id="context-sources-heading">{t("contextKnowledgeSources")}</h3>
        <p>
          {t("contextSourceSummary", {
            available: context.knowledge.citations.length,
            total: context.knowledge.totalCitationCount,
          })}
        </p>
        {context.knowledge.revokedOrUnavailableCount > 0 ? (
          <p className="rm-context-notice">
            {t("contextSourcesRevoked", {
              count: context.knowledge.revokedOrUnavailableCount,
            })}
          </p>
        ) : null}
        {context.knowledge.citations.length === 0 ? null : (
          <ul>
            {context.knowledge.citations.map((citation) => (
              <li key={`${citation.documentId}:${citation.chunkId}`}>
                {citation.title}
                {citation.sourceType === undefined
                  ? ""
                  : ` · ${citation.sourceType}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="context-tools-heading">
        <h3 id="context-tools-heading">{t("contextToolsUsed")}</h3>
        {context.tools.length === 0 ? (
          <p>{t("contextNoTools")}</p>
        ) : (
          <ul>
            {context.tools.map((tool) => (
              <li key={`${tool.toolId}:${tool.startedAt}`}>
                <strong>{tool.toolId}</strong> · {tool.status} ·{" "}
                {tool.riskLevel}
                {tool.approvalRequired
                  ? ` · ${t("contextApprovalRequired")}`
                  : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="context-policies-heading">
        <h3 id="context-policies-heading">{t("contextEffectivePolicies")}</h3>
        <dl className="rm-context-stats">
          <Entry
            label={t("contextMemoryPolicy")}
            value={context.policies.memoryMode}
          />
          {context.policies.memoryMessageLimit === undefined ? null : (
            <div>
              <dt>{t("contextMemoryMessageLimit")}</dt>
              <dd>
                <LocalizedNumber value={context.policies.memoryMessageLimit} />
              </dd>
            </div>
          )}
          <Entry
            label={t("contextKnowledgeGrounding")}
            value={context.policies.knowledgeGroundingMode ?? t("none")}
          />
          <div>
            <dt>{t("contextBlockedTermCount")}</dt>
            <dd>
              <LocalizedNumber value={context.policies.blockedTermCount} />
            </dd>
          </div>
          {context.policies.maxUserInputLength === undefined ? null : (
            <div>
              <dt>{t("contextMaxUserInputLength")}</dt>
              <dd>
                <LocalizedNumber value={context.policies.maxUserInputLength} />
              </dd>
            </div>
          )}
          <Entry
            label={t("contextPromptInjectionGuard")}
            value={
              context.policies.promptInjectionGuard === undefined
                ? t("disabled")
                : t("enabled")
            }
          />
        </dl>
      </section>

      <section aria-labelledby="context-transformations-heading">
        <h3 id="context-transformations-heading">
          {t("contextTransformations")}
        </h3>
        {context.transformations.length === 0 ? (
          <p>{t("contextNoTransformations")}</p>
        ) : (
          <ul>
            {context.transformations.map((transformation) => (
              <li key={transformation.type}>
                {transformationLabel(transformation.type, t)}
                {transformation.count === undefined
                  ? ""
                  : ` · ${transformation.count}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="context-checkpoints-heading">
        <h3 id="context-checkpoints-heading">{t("contextCheckpoints")}</h3>
        {context.checkpoints.length === 0 ? (
          <p>{t("contextNoCheckpoints")}</p>
        ) : (
          <ol>
            {context.checkpoints.map((checkpoint) => (
              <li key={`${checkpoint.sequence}:${checkpoint.type}`}>
                {checkpoint.type} ·{" "}
                <LocalizedDateTime value={checkpoint.createdAt} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Entry({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function transformationLabel(
  type: PersistedRunContext["transformations"][number]["type"],
  t: ReturnType<typeof useLocale>["t"],
): string {
  if (type === "content_policy_applied")
    return t("contextTransformContentPolicy");
  if (type === "history_trimmed") return t("contextTransformHistoryTrimmed");
  if (type === "knowledge_dropped")
    return t("contextTransformKnowledgeDropped");
  if (type === "knowledge_prompt_injection_filtered")
    return t("contextTransformInjectionFiltered");
  return t("contextTransformProviderFallback");
}
