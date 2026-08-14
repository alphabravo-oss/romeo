import { Field, InlineError, Input, NativeSelect } from "@romeo/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  capabilityOverviewQueryOptions,
  capabilityAdminGroupsQueryOptions,
  capabilityAdminUsersQueryOptions,
  type CapabilityScope,
} from "../features/capabilities";
import {
  agentsQueryOptions,
  bootstrapQueryOptions,
} from "../lib/api-query-options";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { useRouterApiClient } from "../lib/router-context";
import { CapabilityAdminRow } from "./CapabilityAdminRow";
import { capabilityCopyFor } from "./capability-admin-policy";
import { CapabilityFlagAdminPanel } from "./CapabilityFlagAdminPanel";
import { CapabilityPlatformPosturePanel } from "./CapabilityPlatformPosturePanel";
import {
  buildCapabilityScopeOptions,
  type CapabilityScopeOption,
} from "./capability-admin-scopes";
import { Section } from "./console";

export function CapabilityAdminPanel(): React.ReactNode {
  const apiClient = useRouterApiClient();
  const { t } = useLocale();
  const bootstrap = useQuery(bootstrapQueryOptions(apiClient));
  const groups = useQuery(capabilityAdminGroupsQueryOptions(apiClient));
  const users = useQuery(capabilityAdminUsersQueryOptions(apiClient));
  const [scopeKey, setScopeKey] = useState<string>();
  const [identityWorkspaceId, setIdentityWorkspaceId] = useState<string>();
  const subjectOrgId = bootstrap.data?.subject.orgId;
  const workspaces = useMemo(
    () =>
      (bootstrap.data?.workspaces ?? []).filter(
        (workspace) =>
          workspace.orgId === subjectOrgId && !workspace.archivedAt,
      ),
    [bootstrap.data?.workspaces, subjectOrgId],
  );
  const agentQueries = useQueries({
    queries: workspaces.map((workspace) =>
      agentsQueryOptions(workspace.id, apiClient),
    ),
  });
  const agents = agentQueries.flatMap((query) => query.data ?? []);
  const identityWorkspace =
    workspaces.find((workspace) => workspace.id === identityWorkspaceId) ??
    workspaces[0];
  const organizationName = bootstrap.data?.organizations.find(
    (item) => item.id === subjectOrgId,
  )?.name;
  const scopeOptions = buildCapabilityScopeOptions({
    workspaces,
    agents,
    ...(subjectOrgId === undefined ? {} : { subjectOrgId }),
    ...(organizationName === undefined ? {} : { organizationName }),
    ...(groups.data === undefined ? {} : { groups: groups.data }),
    ...(users.data === undefined ? {} : { users: users.data }),
    ...(identityWorkspace === undefined
      ? {}
      : { identityWorkspaceId: identityWorkspace.id }),
  });
  const selected =
    scopeOptions.find((item) => item.key === scopeKey) ?? scopeOptions[0];

  if (bootstrap.isPending) {
    return <div className="rm-loading" role="status" />;
  }
  if (bootstrap.isError) {
    return (
      <InlineError role="alert">{t("capabilityScopeLoadFailed")}</InlineError>
    );
  }
  if (selected === undefined) {
    return (
      <>
        {bootstrap.data?.subject.adminRole === "global_admin" ? (
          <CapabilityPlatformPosturePanel />
        ) : null}
        <CapabilityFlagAdminPanel capabilityScopes={[]} />
        <InlineError role="alert">
          {t("capabilityWorkspaceRequired")}
        </InlineError>
      </>
    );
  }

  return (
    <>
      {bootstrap.data.subject.adminRole === "global_admin" ? (
        <CapabilityPlatformPosturePanel />
      ) : null}
      <CapabilityFlagAdminPanel
        capabilityScopes={scopeOptions.flatMap((option) =>
          option.scope.scopeType === "organization" ||
          option.scope.scopeType === "workspace"
            ? [option.scope]
            : [],
        )}
      />
      <CapabilityScopePanel
        key={`${selected.key}:${selected.scope.workspaceId}`}
        identityWorkspaceId={identityWorkspace?.id}
        onIdentityWorkspaceChange={setIdentityWorkspaceId}
        onScopeChange={setScopeKey}
        scope={selected.scope}
        scopeKey={selected.key}
        scopeOptions={scopeOptions}
        workspaces={workspaces}
      />
      {groups.isError ||
      users.isError ||
      agentQueries.some((item) => item.isError) ? (
        <InlineError role="alert">{t("capabilityScopeLoadFailed")}</InlineError>
      ) : null}
    </>
  );
}

function CapabilityScopePanel({
  identityWorkspaceId,
  onIdentityWorkspaceChange,
  onScopeChange,
  scope,
  scopeKey,
  scopeOptions,
  workspaces,
}: {
  identityWorkspaceId: string | undefined;
  onIdentityWorkspaceChange: (value: string) => void;
  onScopeChange: (value: string) => void;
  scope: CapabilityScope;
  scopeKey: string;
  scopeOptions: CapabilityScopeOption[];
  workspaces: Array<{ id: string; name: string }>;
}) {
  const apiClient = useRouterApiClient();
  const { t } = useLocale();
  const overview = useQuery(capabilityOverviewQueryOptions(scope, apiClient));
  return (
    <Section
      description={t("capabilityAdminIntro")}
      title={t("capabilityAdministration")}
    >
      <div className="grid gap-5">
        <Field
          description={t("capabilityScopeDescription")}
          label={t("capabilityScope")}
        >
          <NativeSelect
            onChange={(event) => onScopeChange(event.currentTarget.value)}
            value={scopeKey}
          >
            {scopeOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {t(option.labelKey)}: {option.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {scope.scopeType === "group" || scope.scopeType === "user" ? (
          <Field
            description={t("capabilityEvaluationWorkspaceDescription")}
            label={t("capabilityEvaluationWorkspace")}
          >
            <NativeSelect
              onChange={(event) =>
                onIdentityWorkspaceChange(event.currentTarget.value)
              }
              value={identityWorkspaceId}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <PanelState query={overview}>
          {(data) => (
            <CapabilityOverviewList
              data={data}
              scope={scope}
              scopeKey={scopeKey}
            />
          )}
        </PanelState>
      </div>
    </Section>
  );
}

function CapabilityOverviewList({
  data,
  scope,
  scopeKey,
}: {
  data: import("../features/capabilities").CapabilityAdminOverview;
  scope: CapabilityScope;
  scopeKey: string;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "changed">("all");
  const rows = data.capabilities.filter((row) => {
    const copy = capabilityCopyFor(row.definition.id);
    const haystack = `${t(copy.name)} ${t(copy.description)} ${row.definition.category} ${row.definition.risk} ${row.definition.lifecycle}`.toLowerCase();
    if (query.trim().length > 0 && !haystack.includes(query.trim().toLowerCase()))
      return false;
    if (filter === "changed" && row.configuredAssignment === undefined)
      return false;
    return true;
  });
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {t("capabilityRegistryVersion")}: {data.registryVersion}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("capabilityFilter")}>
          <Input
            name="capability_filter"
            onChange={(event) => setQuery(event.currentTarget.value)}
            value={query}
          />
        </Field>
        <Field label={t("capabilityFilter")}>
          <NativeSelect
            onChange={(event) =>
              setFilter(event.currentTarget.value as "all" | "changed")
            }
            value={filter}
          >
            <option value="all">{t("capabilityFilterAll")}</option>
            <option value="changed">{t("capabilityFilterChanged")}</option>
          </NativeSelect>
        </Field>
      </div>
      {rows.map((row) => (
        <CapabilityAdminRow
          key={`${scopeKey}:${row.definition.id}:${row.configuredAssignment?.version ?? 0}`}
          row={row}
          scope={scope}
        />
      ))}
    </div>
  );
}
