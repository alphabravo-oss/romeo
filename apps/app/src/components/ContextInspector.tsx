import { Button } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import X from "lucide-react/dist/esm/icons/x.mjs";
import { useEffect, useRef } from "react";

import type { RunContextPreview } from "../features/chat";
import { useLocale } from "../lib/i18n";
import { LocalizedTokens } from "../lib/locale-format";
import { persistedRunContextQueryOptions } from "../lib/persisted-run-context-query";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { PersistedContextInspector } from "./PersistedContextInspector";
import { ReasoningPolicyPreview } from "./ReasoningPolicyPreview";

export function ContextInspector({
  chatId,
  error,
  loading,
  onClose,
  preview,
}: {
  chatId?: string | undefined;
  error?: string | undefined;
  loading: boolean;
  onClose: () => void;
  preview?: RunContextPreview | undefined;
}) {
  const { t } = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const inspection = useQuery(persistedRunContextQueryOptions(chatId));
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const inspectionError = inspection.isError
    ? safeUserErrorMessage(inspection.error, t("contextInspectionFailed"))
    : undefined;
  const inspecting = loading || (chatId !== undefined && inspection.isPending);
  return (
    <aside
      aria-describedby="context-inspector-description"
      aria-labelledby="context-inspector-title"
      aria-modal="false"
      className="rm-context-inspector"
      role="dialog"
    >
      <header>
        <div>
          <strong id="context-inspector-title">{t("contextInspector")}</strong>
          <p id="context-inspector-description">
            {t("contextInspectorDescription")}
          </p>
        </div>
        <Button
          aria-label={t("closeContextInspector")}
          onClick={onClose}
          ref={closeRef}
          type="button"
          variant="ghost"
        >
          <X size={16} />
        </Button>
      </header>
      {inspecting ? (
        <div aria-live="polite" className="rm-context-loading" role="status">
          {t("inspectingContext")}
        </div>
      ) : null}
      {(error ?? inspectionError) ? (
        <div className="rm-composer-error" role="alert">
          {error ?? inspectionError}
        </div>
      ) : null}
      {inspection.data?.data ? (
        <PersistedContextInspector context={inspection.data.data} />
      ) : null}
      {chatId !== undefined &&
      !inspection.isPending &&
      !inspection.isError &&
      inspection.data?.data === null ? (
        <p className="rm-context-notice">{t("contextNoRun")}</p>
      ) : null}
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
          {preview.reasoningPolicy ? (
            <ReasoningPolicyPreview policy={preview.reasoningPolicy} />
          ) : null}
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
        </div>
      ) : null}
    </aside>
  );
}
