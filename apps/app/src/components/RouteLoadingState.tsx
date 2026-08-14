import { useLocale } from "../lib/i18n";

export function RouteLoadingState() {
  const { t } = useLocale();
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="rm-loading"
      role="status"
    >
      {t("loading")}
    </div>
  );
}
