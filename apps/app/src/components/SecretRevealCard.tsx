import { Button } from "@romeo/ui";

import { useLocale } from "../lib/i18n";

export function SecretRevealCard({
  label,
  secret,
  onDismiss,
}: {
  label: string;
  secret: string;
  onDismiss: () => void;
}) {
  const { t } = useLocale();

  return (
    <div
      className="mt-3 rounded-md border border-border p-3 text-sm"
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted">{label}</div>
        <div className="flex gap-2">
          <Button
            onClick={() => void navigator.clipboard.writeText(secret)}
            type="button"
          >
            {t("copy")}
          </Button>
          <Button onClick={onDismiss} type="button">
            {t("dismiss")}
          </Button>
        </div>
      </div>
      <div className="mt-2 break-all font-mono">{secret}</div>
      <div className="rm-composer-error mt-2" role="alert">
        {t("secretShownOnce")}
      </div>
    </div>
  );
}
