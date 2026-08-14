import { createFileRoute } from "@tanstack/react-router";
import Bell from "lucide-react/dist/esm/icons/bell.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import Brain from "lucide-react/dist/esm/icons/brain.mjs";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen.mjs";
import Smartphone from "lucide-react/dist/esm/icons/smartphone.mjs";
import UserIcon from "lucide-react/dist/esm/icons/user.mjs";
import { Suspense } from "react";

import { ConsoleLayout } from "../components/ConsoleLayout";
import { PageHeader } from "../components/PageHeader";
import {
  DeviceTokensPanel,
  InterfaceSettings,
  NotificationPanel,
  PersonalContentPanel,
  preloadSettingsSection,
  SettingsAccountSection,
  SettingsSecuritySection,
} from "../components/settings-lazy-panels";
import { useWorkspace } from "../components/WorkspaceContext";
import { WorkspaceUserMenu } from "../components/WorkspaceUserMenu";
import {
  localeNamespacesForSettingsSection,
  useLocale,
  useLocaleNamespaces,
} from "../lib/i18n";
import { resolveSectionKey } from "../lib/section-routing";
import { prefetchPrimaryRouteData } from "../lib/route-data";
import { validatedWorkspaceRouteSearch } from "../lib/route-workspace-selection";

export const Route = createFileRoute("/settings")({
  loaderDeps: ({ search }) => ({ workspaceId: search.workspace }),
  loader: ({ cause, context, deps }) =>
    prefetchPrimaryRouteData(
      "settings",
      context,
      cause === "preload" ? "intent" : "navigation",
      deps,
    ),
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: string; workspace?: string } => ({
    ...(typeof search.section === "string" ? { section: search.section } : {}),
    ...validatedWorkspaceRouteSearch(search.workspace),
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { subject, workspace } = useWorkspace();
  const { t } = useLocale();
  const { section: sectionParam } = Route.useSearch();
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
  useLocaleNamespaces(localeNamespacesForSettingsSection(section));

  return (
    <ConsoleLayout
      active={section}
      groups={groups}
      route="/settings"
      title={t("settings")}
      onSectionIntent={preloadSettingsSection}
      userMenu={
        <WorkspaceUserMenu
          isAdmin={subject?.isAdmin === true}
          userLabel={
            subject?.name ?? subject?.email ?? subject?.id ?? t("account")
          }
        />
      }
    >
      <PageHeader
        description={meta[section]!.description}
        title={meta[section]!.title}
      />
      <Suspense
        fallback={
          <div className="rm-loading" role="status">
            {t("loading")}
          </div>
        }
      >
        {section === "interface" ? <InterfaceSettings /> : null}
        {section === "notifications" ? <NotificationPanel /> : null}
        {section === "memories" ? (
          <PersonalContentPanel kind="memories" />
        ) : null}
        {section === "notes" ? <PersonalContentPanel kind="notes" /> : null}
        {section === "account" ? (
          <SettingsAccountSection
            subject={subject}
            workspaceName={workspace?.name}
          />
        ) : null}
        {section === "security" ? <SettingsSecuritySection /> : null}
        {section === "device-tokens" ? <DeviceTokensPanel /> : null}
      </Suspense>
    </ConsoleLayout>
  );
}
