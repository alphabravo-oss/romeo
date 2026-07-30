import type { AgentVersionDiff } from "../features/types";
import { useLocale, type MessageKey } from "../lib/i18n";

export function AgentVersionDiffSummary({ diff }: { diff: AgentVersionDiff }) {
  const { t } = useLocale();
  if (diff.changes.length === 0)
    return <div className="text-sm text-muted">{t("agentNoChanges")}</div>;

  return (
    <div className="grid gap-2 text-sm">
      {diff.changes.map((change) => (
        <div className="rounded-md border border-border p-2" key={change.field}>
          <div className="font-medium">
            {formatAgentDiffField(change.field, t)}
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted">{t("agentDiffBefore")}</div>
              <div className="break-words">{formatValue(change.left)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">{t("agentDiffAfter")}</div>
              <div className="break-words">{formatValue(change.right)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "—";
}

const agentDiffFieldKeys: Readonly<Record<string, MessageKey>> = {
  baseModelId: "agentDiffFieldBaseModel",
  knowledgeBaseBindings: "agentDiffFieldKnowledgeBaseBindings",
  memoryPolicy: "agentDiffFieldMemoryPolicy",
  parameters: "agentDiffFieldParameters",
  promptSuggestions: "agentDiffFieldPromptSuggestions",
  safetySettings: "agentDiffFieldSafetySettings",
  systemPrompt: "agentDiffFieldSystemPrompt",
  tags: "agentDiffFieldTags",
  toolBindings: "agentDiffFieldToolBindings",
  voiceProfileId: "agentDiffFieldVoiceProfile",
};

function formatAgentDiffField(
  field: AgentVersionDiff["changes"][number]["field"],
  t: (key: MessageKey) => string,
): string {
  const key = agentDiffFieldKeys[field];
  return key === undefined ? field : t(key);
}
