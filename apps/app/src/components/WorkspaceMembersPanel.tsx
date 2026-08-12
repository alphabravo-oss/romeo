import { NativeSelect } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  listWorkspaceMembers,
  revokeWorkspaceMember,
  shareWorkspace,
} from "../features/access/api";
import { listWorkspaces } from "../features/tenancy/queries";
import { useLocale } from "../lib/i18n";
import { ResourceGrantEditor } from "./ResourceGrantEditor";
import { SettingsSection } from "./SettingsSection";

export function WorkspaceMembersPanel() {
  const { t } = useLocale();
  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: listWorkspaces,
  });
  const workspaces = workspacesQuery.data ?? [];
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const selectedId = workspaces.some((item) => item.id === workspaceId)
    ? workspaceId
    : (workspaces[0]?.id ?? "");
  const membersQuery = useQuery({
    queryKey: ["workspaceMembers", selectedId],
    queryFn: () => listWorkspaceMembers(selectedId),
    enabled: selectedId.length > 0,
  });

  return (
    <SettingsSection
      description={t("workspaceMembersHelp")}
      title={t("workspaceMembersTitle")}
    >
      <label className="grid gap-1 text-sm">
        <span className="text-muted">{t("workspace")}</span>
        <NativeSelect
          name="workspace-members-workspace"
          onChange={(event) => setWorkspaceId(event.currentTarget.value)}
          value={selectedId}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      {selectedId.length > 0 ? (
        <ResourceGrantEditor
          grants={membersQuery.data ?? []}
          onGrant={(share) => shareWorkspace(selectedId, share)}
          onRevoke={(grantId) => revokeWorkspaceMember(selectedId, grantId)}
          permissionOptions={["read"]}
          queryKey={["workspaceMembers", selectedId]}
        />
      ) : null}
    </SettingsSection>
  );
}
