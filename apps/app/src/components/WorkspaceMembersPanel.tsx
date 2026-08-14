import { NativeSelect } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { revokeWorkspaceMember, shareWorkspace } from "../features/access/api";
import { workspaceMembersQueryOptions } from "../features/access/query-options";
import { workspacesQueryOptions } from "../features/tenancy";
import { useLocale } from "../lib/i18n";
import { Section } from "./console";
import { ResourceGrantEditor } from "./ResourceGrantEditor";
import * as appQueryKeys from "../lib/app-query-keys";

export function WorkspaceMembersPanel() {
  const { t } = useLocale();
  const workspacesQuery = useQuery(workspacesQueryOptions());
  const workspaces = workspacesQuery.data ?? [];
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const selectedId = workspaces.some((item) => item.id === workspaceId)
    ? workspaceId
    : (workspaces[0]?.id ?? "");
  const membersQuery = useQuery(workspaceMembersQueryOptions(selectedId));

  // No section title: the page header already reads "Workspace members", and
  // the old two-column settings split put a duplicate heading in a label rail
  // beside controls that then ran the full width of the page.
  return (
    <Section description={t("workspaceMembersHelp")}>
      <label className="cs-fields grid gap-1 text-sm">
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
          queryKey={appQueryKeys.workspaceMembers(selectedId)}
        />
      ) : null}
    </Section>
  );
}
