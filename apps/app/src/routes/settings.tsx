import { createFileRoute } from "@tanstack/react-router";
import Bell from "lucide-react/dist/esm/icons/bell.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import UserIcon from "lucide-react/dist/esm/icons/user.mjs";

import { AccountSecurityPanel } from "../components/AccountSecurityPanel";
import { ConsoleLayout } from "../components/ConsoleLayout";
import { ProfileEditPanel } from "../components/ProfileEditPanel";
import { InterfaceSettings } from "../components/InterfaceSettings";
import { NotificationPanel } from "../components/NotificationPanel";
import { PageHeader } from "../components/PageHeader";
import { SessionsPanel } from "../components/SessionsPanel";
import { useWorkspaceData } from "../components/useWorkspaceData";

export const Route = createFileRoute("/settings")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: string } =>
    typeof search.section === "string" ? { section: search.section } : {},
  component: SettingsPage,
});

const GROUPS = [
  {
    label: "Preferences",
    items: [
      { key: "interface", label: "Interface", icon: SlidersHorizontal },
      { key: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Account",
    items: [
      { key: "account", label: "Profile", icon: UserIcon },
      { key: "security", label: "Security", icon: ShieldCheck },
    ],
  },
];

const META: Record<string, { title: string; description: string }> = {
  interface: {
    title: "Interface",
    description: "Personalize how Romeo looks and behaves for you.",
  },
  notifications: {
    title: "Notifications",
    description: "Choose what you're notified about and where.",
  },
  account: {
    title: "Profile",
    description: "Your identity and role within this organization.",
  },
  security: {
    title: "Security",
    description: "Review the devices signed in to your account.",
  },
};

function SettingsPage() {
  const data = useWorkspaceData(undefined);
  const { section: sectionParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const section = sectionParam ?? "interface";

  return (
    <ConsoleLayout
      active={section}
      groups={GROUPS}
      onSelect={(key) => void navigate({ search: { section: key } })}
      title="Settings"
    >
      <PageHeader
        description={META[section]!.description}
        title={META[section]!.title}
      />
      {section === "interface" ? <InterfaceSettings /> : null}
      {section === "notifications" ? <NotificationPanel /> : null}
      {section === "account" ? (
        <div className="grid gap-4">
        <div className="rm-panel p-4">
          <div className="rm-card-title">Identity</div>
          <dl className="rm-defs">
            <div>
              <dt>User</dt>
              <dd>{data.subject?.id ?? "—"}</dd>
            </div>
            <div>
              <dt>Organization</dt>
              <dd>{data.subject?.orgId ?? "—"}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{data.subject?.isAdmin ? "Admin" : "Member"}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{data.workspace?.name ?? "—"}</dd>
            </div>
          </dl>
        </div>
        <ProfileEditPanel currentName={data.subject?.name} currentEmail={data.subject?.email} />
        </div>
      ) : null}
      {section === "security" ? (
        <div className="grid gap-4">
          <AccountSecurityPanel />
          <SessionsPanel />
        </div>
      ) : null}
    </ConsoleLayout>
  );
}
