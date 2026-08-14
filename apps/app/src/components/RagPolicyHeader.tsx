import { useLocale } from "../lib/i18n";
import { PageActions } from "./PageActions";

export function RagPolicyHeader(props: {
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useLocale();
  return (
    <div className="rm-card-header">
      <div>
        <div className="rm-card-title">{t("ragSetupTitle")}</div>
        <p className="text-sm text-muted">{t("ragSetupDescription")}</p>
      </div>
      <PageActions
        onRefresh={props.onRefresh}
        refreshLabel={t("refresh")}
        refreshing={props.refreshing}
      />
    </div>
  );
}
