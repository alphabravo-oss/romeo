import { Button, IconButton, Input, StatusBadge } from "@romeo/ui";
import X from "lucide-react/dist/esm/icons/x.mjs";
import { useState } from "react";

import { useLocale } from "../lib/i18n";

function entriesFromValue(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function IdListEditor({
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState("");
  const entries = entriesFromValue(value);
  const addEntry = () => {
    const next = draft.trim();
    if (next.length === 0) return;
    if (!entries.includes(next)) onChange([...entries, next].join("\n"));
    setDraft("");
  };
  return (
    <fieldset className="grid gap-2 rounded-md border border-border p-3">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2" aria-live="polite">
        {entries.length === 0 ? (
          <span className="text-sm text-muted">{t("abuseNoKillSwitches")}</span>
        ) : (
          entries.map((entry) => (
            <StatusBadge className="gap-1" key={entry}>
              <span translate="no">{entry}</span>
              <IconButton
                aria-label={`${t("abuseRemoveKillSwitch")}: ${entry}`}
                onClick={() =>
                  onChange(
                    entries.filter((value) => value !== entry).join("\n"),
                  )
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                <X aria-hidden size={12} />
              </IconButton>
            </StatusBadge>
          ))
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          name={id}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addEntry();
          }}
          placeholder={placeholder}
          value={draft}
        />
        <Button
          disabled={draft.trim().length === 0}
          onClick={addEntry}
          type="button"
        >
          + {t("abuseAddKillSwitch")}
        </Button>
      </div>
    </fieldset>
  );
}
