import { Button } from "@romeo/ui";
import X from "lucide-react/dist/esm/icons/x.mjs";

import type { RunContextPreview } from "../features/chat";
import { LocalizedTokens } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";

export function ContextInspector({
  error,
  loading,
  onClose,
  preview,
}: {
  error?: string;
  loading: boolean;
  onClose: () => void;
  preview?: RunContextPreview;
}) {
  const { t } = useLocale();
  return (
    <aside aria-label={t("contextInspector")} className="rm-context-inspector">
      <header>
        <div>
          <strong>{t("contextInspector")}</strong>
          <p>{t("contextInspectorDescription")}</p>
        </div>
        <Button
          aria-label={t("closeContextInspector")}
          onClick={onClose}
          type="button"
        >
          <X size={16} />
        </Button>
      </header>
      {loading ? (
        <div className="rm-context-loading">{t("inspectingContext")}</div>
      ) : null}
      {error ? <div className="rm-composer-error">{error}</div> : null}
      {preview ? (
        <div className="rm-context-body">
          <section>
            <h3>{preview.model.name}</h3>
            <dl className="rm-context-stats">
              <div>
                <dt>{t("estimatedInput")}</dt>
                <dd>
                  <LocalizedTokens
                    value={preview.budget.estimatedInputTokens}
                  />
                </dd>
              </div>
              <div>
                <dt>{t("usableBudget")}</dt>
                <dd>
                  <LocalizedTokens value={preview.budget.usableInputTokens} />
                </dd>
              </div>
              <div>
                <dt>{t("remainingBudget")}</dt>
                <dd>
                  <LocalizedTokens
                    value={preview.budget.remainingInputTokens}
                  />
                </dd>
              </div>
              <div>
                <dt>{t("history")}</dt>
                <dd>
                  {preview.history.includedMessages}/
                  {preview.history.availableMessages}
                  {preview.history.truncated ? ` (${t("trimmed")})` : ""}
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>{t("filesAndKnowledge")}</h3>
            <p>
              {preview.attachments.currentFiles.length} {t("currentFiles")},{" "}
              {preview.attachments.retainedDocuments.length}{" "}
              {t("retainedDocuments")}, {preview.attachments.retainedImages}{" "}
              {t("retainedImages")}, {preview.attachments.pendingImages}{" "}
              {t("pendingImages")}.
            </p>
            <p>
              {preview.knowledge.length} {t("authorizedKnowledgeResults")}.
            </p>
            <p>
              {preview.memories.length} {t("retainedMemoryItems")}.
            </p>
            {preview.memories.length > 0 ? (
              <ul>
                {preview.memories.map((memory) => (
                  <li key={memory.id}>
                    {memory.title} · {memory.scope}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <section>
            <h3>{t("providerMessages")}</h3>
            {preview.messages.map((message, index) => (
              <details
                key={`${message.role}-${index}`}
                open={index === preview.messages.length - 1}
              >
                <summary>
                  {message.role}
                  {message.imageCount
                    ? ` · ${message.imageCount} ${t("images")}`
                    : ""}
                </summary>
                <pre>{message.content}</pre>
              </details>
            ))}
          </section>
        </div>
      ) : null}
    </aside>
  );
}
