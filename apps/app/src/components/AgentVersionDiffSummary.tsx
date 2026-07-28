import type { AgentVersionDiff } from "../features/types";
import { useLocale } from "../lib/i18n";

export function AgentVersionDiffSummary({ diff }: { diff: AgentVersionDiff }) {
  const { t } = useLocale();
  if (diff.changes.length === 0)
    return <div className="text-sm text-muted">{t("agentNoChanges")}</div>;

  return (
    <div className="grid gap-2 text-sm">
      {diff.changes.map((change) => (
        <div className="rounded-md border border-border p-2" key={change.field}>
          <div className="font-medium">{change.field}</div>
          <div className="break-words text-muted">
            {formatValue(change.right)}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
