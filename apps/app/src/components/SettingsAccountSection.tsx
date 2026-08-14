import { useLocale } from "../lib/i18n";
import { ProfileEditPanel } from "./ProfileEditPanel";

export function SettingsAccountSection({
  subject,
  workspaceName,
}: {
  subject:
    | {
        email?: string;
        id: string;
        isAdmin?: boolean;
        name?: string;
        orgId: string;
      }
    | undefined;
  workspaceName: string | undefined;
}) {
  const { t } = useLocale();
  return (
    <div className="grid gap-4">
      <div>
        <div className="rm-card-title">{t("profile")}</div>
        <dl className="rm-defs">
          <div>
            <dt>{t("user")}</dt>
            <dd>{subject?.id ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("organization")}</dt>
            <dd>{subject?.orgId ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("role")}</dt>
            <dd>{subject?.isAdmin ? t("admin") : t("member")}</dd>
          </div>
          <div>
            <dt>{t("workspace")}</dt>
            <dd>{workspaceName ?? "—"}</dd>
          </div>
        </dl>
      </div>
      <ProfileEditPanel
        currentName={subject?.name}
        currentEmail={subject?.email}
      />
    </div>
  );
}
