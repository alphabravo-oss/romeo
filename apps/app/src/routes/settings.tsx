import { createFileRoute } from "@tanstack/react-router";
import Bell from "lucide-react/dist/esm/icons/bell.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import Brain from "lucide-react/dist/esm/icons/brain.mjs";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen.mjs";
import Smartphone from "lucide-react/dist/esm/icons/smartphone.mjs";
import UserIcon from "lucide-react/dist/esm/icons/user.mjs";

import { AccountSecurityPanel } from "../components/AccountSecurityPanel";
import { ConsoleLayout } from "../components/ConsoleLayout";
import { ProfileEditPanel } from "../components/ProfileEditPanel";
import { InterfaceSettings } from "../components/InterfaceSettings";
import { NotificationPanel } from "../components/NotificationPanel";
import { PageHeader } from "../components/PageHeader";
import { SessionsPanel } from "../components/SessionsPanel";
import { DeviceTokensPanel } from "../components/DeviceTokensPanel";
import { PersonalContentPanel } from "../components/PersonalContentPanel";
import { useWorkspaceData } from "../components/useWorkspaceData";
import { WorkspaceUserMenu } from "../components/WorkspaceUserMenu";
import {
  localeNamespaceGroups,
  useLocale,
  useLocaleNamespaces,
} from "../lib/i18n";
import { resolveSectionKey } from "../lib/section-routing";

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { section?: string } =>
    typeof search.section === "string" ? { section: search.section } : {},
  component: SettingsPage,
});

function SettingsPage() {
  useLocaleNamespaces(localeNamespaceGroups.settings);
  const data = useWorkspaceData(undefined);
  const { t } = useLocale();
  const { section: sectionParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const groups = [
    {
      label: t("preferences"),
      items: [
        { key: "interface", label: t("interface"), icon: SlidersHorizontal },
        { key: "notifications", label: t("notifications"), icon: Bell },
        { key: "memories", label: t("memory"), icon: Brain },
        { key: "notes", label: t("note"), icon: NotebookPen },
      ],
    },
    {
      label: t("account"),
      items: [
        { key: "account", label: t("profile"), icon: UserIcon },
        { key: "security", label: t("security"), icon: ShieldCheck },
        {
          key: "device-tokens",
          label: t("deviceTokensTitle"),
          icon: Smartphone,
        },
      ],
    },
  ];
  const meta: Record<string, { title: string; description: string }> = {
    interface: {
      title: t("interface"),
      description: t("interfaceDescription"),
    },
    notifications: {
      title: t("notifications"),
      description: t("notificationsDescription"),
    },
    memories: { title: t("memory"), description: t("memoryDescription") },
    notes: { title: t("note"), description: t("notesDescription") },
    account: { title: t("profile"), description: t("profileDescription") },
    security: { title: t("security"), description: t("securityDescription") },
    "device-tokens": {
      title: t("deviceTokensTitle"),
      description: t("adminDeviceTokensDescription"),
    },
  };
  const section = resolveSectionKey(sectionParam, meta, "interface");

  return (
    <ConsoleLayout
      active={section}
      groups={groups}
      onSelect={(key) => void navigate({ search: { section: key } })}
      title={t("settings")}
      userMenu={
        <WorkspaceUserMenu
          isAdmin={data.subject?.isAdmin === true}
          userLabel={
            data.subject?.name ??
            data.subject?.email ??
            data.subject?.id ??
            t("account")
          }
        />
      }
    >
      <PageHeader
        description={meta[section]!.description}
        title={meta[section]!.title}
      />
      {section === "interface" ? <InterfaceSettings /> : null}
      {section === "notifications" ? <NotificationPanel /> : null}
      {section === "memories" ? <PersonalContentPanel kind="memories" /> : null}
      {section === "notes" ? <PersonalContentPanel kind="notes" /> : null}
      {section === "account" ? (
        <div className="grid gap-4">
          <div className="rm-panel p-4">
            <div className="rm-card-title">{t("profile")}</div>
            <dl className="rm-defs">
              <div>
                <dt>{t("user")}</dt>
                <dd>{data.subject?.id ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("organization")}</dt>
                <dd>{data.subject?.orgId ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("role")}</dt>
                <dd>{data.subject?.isAdmin ? t("admin") : t("member")}</dd>
              </div>
              <div>
                <dt>{t("workspace")}</dt>
                <dd>{data.workspace?.name ?? "—"}</dd>
              </div>
            </dl>
          </div>
          <ProfileEditPanel
            currentName={data.subject?.name}
            currentEmail={data.subject?.email}
          />
        </div>
      ) : null}
      {section === "security" ? (
        <div className="grid gap-4">
          <AccountSecurityPanel />
          <SessionsPanel />
        </div>
      ) : null}
      {section === "device-tokens" ? <DeviceTokensPanel /> : null}
    </ConsoleLayout>
  );
}
