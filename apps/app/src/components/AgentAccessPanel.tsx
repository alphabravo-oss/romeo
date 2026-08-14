import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.mjs";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";

import { Button, Checkbox, Input, Select, StatusBadge } from "@romeo/ui";

import { shareTargetsQueryOptions } from "../features/collaboration";
import type { ShareTarget } from "../features/types";
import {
  agentReadinessQueryOptions,
  agentSharesQueryOptions,
} from "../features/managed-models";
import {
  revokeAgentGrantMutationOptions,
  shareAgentAccessMutationOptions,
} from "../features/managed-models/mutation-options";
import type { Agent, ManagedModelReadiness } from "../features/managed-models";
import { useLocale, type MessageKey } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { createColumnHelper, DataTable } from "./DataTable";
import {
  groupAgentShares,
  type AgentAccessRow,
  type AgentPermission,
} from "./agent-access-model";

const defaultPermissions: Record<AgentPermission, boolean> = {
  read: true,
  run: true,
  write: false,
};
const emptyTargets: ShareTarget[] = [];
const accessColumnHelper = createColumnHelper<AgentAccessRow>();

export function AgentAccessPanel({
  activeAgent,
  onNotice,
}: {
  activeAgent: Agent | undefined;
  onNotice: (notice: string | undefined) => void;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [selectedTargetKey, setSelectedTargetKey] = useState("");
  const [permissions, setPermissions] = useState(defaultPermissions);

  const targetsQuery = useQuery(shareTargetsQueryOptions({ query }, query));
  const sharesQuery = useQuery(agentSharesQueryOptions(activeAgent?.id));
  const shareMutation = useMutation(shareAgentAccessMutationOptions());
  const revokeMutation = useMutation(revokeAgentGrantMutationOptions());
  const targets = targetsQuery.data ?? emptyTargets;
  const groupedShares = useMemo(
    () => groupAgentShares(sharesQuery.data ?? []),
    [sharesQuery.data],
  );
  const targetsByKey = useMemo(
    () => new Map(targets.map((target) => [targetKey(target), target])),
    [targets],
  );
  const selectedTarget = targets.find(
    (target) => targetKey(target) === selectedTargetKey,
  );
  const readinessQuery = useQuery(
    agentReadinessQueryOptions({
      agentId: activeAgent?.id,
      principalType: selectedTarget?.principalType,
      principalId: selectedTarget?.principalId,
    }),
  );
  const selectedPermissions = (
    Object.entries(permissions) as Array<[AgentPermission, boolean]>
  )
    .filter(([, enabled]) => enabled)
    .map(([permission]) => permission);

  useEffect(() => {
    if (targets.length === 0) {
      setSelectedTargetKey("");
      return;
    }
    if (!targets.some((target) => targetKey(target) === selectedTargetKey))
      setSelectedTargetKey(targetKey(targets[0]!));
  }, [selectedTargetKey, targets]);

  async function handleGrant() {
    if (
      !activeAgent ||
      selectedTarget === undefined ||
      selectedPermissions.length === 0
    )
      return;
    try {
      await shareMutation.mutateAsync({
        agentId: activeAgent.id,
        principalType: selectedTarget.principalType,
        principalId: selectedTarget.principalId,
        permissions: selectedPermissions,
      });
      const existing = groupedShares.find(
        (share) =>
          share.principalType === selectedTarget.principalType &&
          share.principalId === selectedTarget.principalId,
      );
      const obsoleteGrantIds =
        existing?.grants
          .filter(
            (grant) =>
              !selectedPermissions.includes(
                grant.permission as AgentPermission,
              ),
          )
          .map((grant) => grant.id) ?? [];
      await Promise.all(
        obsoleteGrantIds.map((grantId) =>
          revokeMutation.mutateAsync({
            agentId: activeAgent.id,
            grantId,
          }),
        ),
      );
      onNotice(t("agentAccessUpdated"));
      toast(t("agentAccessGranted"), "success");
    } catch {
      toast(t("agentCouldNotGrantAccess"), "error");
    }
  }

  const revokeGrants = useCallback(
    async (rows: AgentAccessRow[]) => {
      if (!activeAgent || rows.length === 0) return;
      if (
        typeof window !== "undefined" &&
        !window.confirm(t("agentConfirmRevokeAccess"))
      )
        return;
      try {
        await Promise.all(
          rows.flatMap((row) =>
            row.grants.map((grant) =>
              revokeMutation.mutateAsync({
                agentId: activeAgent.id,
                grantId: grant.id,
              }),
            ),
          ),
        );
        toast(t("agentAccessRevoked"), "success");
      } catch {
        toast(t("agentCouldNotRevokeAccess"), "error");
      }
    },
    [activeAgent, revokeMutation, t],
  );

  function editShare(row: AgentAccessRow) {
    setQuery(row.principalId);
    setSelectedTargetKey(`${row.principalType}:${row.principalId}`);
    setPermissions({
      read: row.permissions.includes("read"),
      run: row.permissions.includes("run"),
      write: row.permissions.includes("write"),
    });
  }

  const accessColumns = useMemo(
    () => [
      accessColumnHelper.accessor(
        (row) =>
          targetsByKey.get(`${row.principalType}:${row.principalId}`)?.label ??
          row.principalId,
        {
          id: "principal",
          header: t("agentAccessPrincipal"),
          cell: ({ getValue, row }) => (
            <span className="block min-w-0">
              <strong className="block truncate">{getValue()}</strong>
              <small className="block truncate text-muted">
                {row.original.principalId}
              </small>
            </span>
          ),
        },
      ),
      accessColumnHelper.accessor("principalType", {
        header: t("agentAccessPrincipalType"),
      }),
      accessColumnHelper.accessor(() => t("agentAccessDirect"), {
        id: "source",
        header: t("agentAccessSource"),
      }),
      ...(["read", "run", "write"] as const).map((permission) =>
        accessColumnHelper.accessor(
          (row) => row.permissions.includes(permission),
          {
            id: permission,
            header: t(permissionMessageKey(permission)),
            cell: ({ getValue }) => (getValue() ? "✓" : "—"),
          },
        ),
      ),
      accessColumnHelper.accessor("createdAt", {
        header: t("agentAccessUpdated"),
        cell: ({ getValue }) =>
          getValue() ? <LocalizedDateTime value={getValue()!} /> : "—",
      }),
      accessColumnHelper.display({
        id: "actions",
        header: t("agentAccessActions"),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              onClick={() => editShare(row.original)}
              size="sm"
              variant="ghost"
            >
              {t("agentAccessEdit")}
            </Button>
            <Button
              disabled={revokeMutation.isPending}
              onClick={() => void revokeGrants([row.original])}
              size="sm"
              variant="ghost"
            >
              {t("agentAccessRevoke")}
            </Button>
          </div>
        ),
      }),
    ],
    [revokeGrants, revokeMutation.isPending, t, targetsByKey],
  );

  function togglePermission(permission: AgentPermission) {
    setPermissions((current) => ({
      ...current,
      [permission]: !current[permission],
    }));
  }

  return (
    <section
      className="rm-managed-model-section"
      data-testid="agent-access-panel"
    >
      <div className="rm-managed-model-section__header">
        <span className="rm-managed-model-section__icon">
          <ShieldCheck aria-hidden="true" size={17} />
        </span>
        <div>
          <h3>{t("agentAccess")}</h3>
          <p>{t("managedModelAccessDescription")}</p>
        </div>
      </div>
      <div className="grid gap-2 text-sm">
        <Input
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("agentSearchShareTargets")}
          value={query}
        />
        <PanelState query={targetsQuery} empty={t("noEligibleShares")}>
          {(loadedTargets) => (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Select
                  onValueChange={setSelectedTargetKey}
                  options={loadedTargets.map((target) => ({
                    label: target.label,
                    value: targetKey(target),
                  }))}
                  value={selectedTargetKey}
                />
                <Button
                  disabled={
                    !activeAgent ||
                    selectedTarget === undefined ||
                    selectedPermissions.length === 0 ||
                    shareMutation.isPending
                  }
                  onClick={() => void handleGrant()}
                  pending={shareMutation.isPending}
                  variant="primary"
                >
                  {t("agentGrant")}
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["read", "run", "write"] as const).map((permission) => (
                  <Checkbox
                    checked={permissions[permission]}
                    key={permission}
                    label={
                      <span className="truncate">
                        {t(permissionMessageKey(permission))}
                      </span>
                    }
                    onCheckedChange={() => togglePermission(permission)}
                  />
                ))}
              </div>
              {readinessQuery.isLoading ? (
                <div className="rm-managed-model-readiness" role="status">
                  {t("managedModelReadinessChecking")}…
                </div>
              ) : readinessQuery.isError ? (
                <div
                  className="rm-managed-model-readiness is-blocked"
                  role="alert"
                >
                  {t("managedModelReadinessFailed")}
                </div>
              ) : readinessQuery.data ? (
                <ReadinessResult report={readinessQuery.data} t={t} />
              ) : null}
            </>
          )}
        </PanelState>
      </div>
      <div className="grid gap-2 text-sm">
        <PanelState query={sharesQuery} empty={t("agentNoAccessGrants")}>
          {() => (
            <DataTable
              bulkActions={(ids, clearSelection) => (
                <Button
                  disabled={revokeMutation.isPending}
                  onClick={() =>
                    void revokeGrants(
                      groupedShares.filter((share) =>
                        ids.includes(
                          `${share.principalType}:${share.principalId}`,
                        ),
                      ),
                    ).then(clearSelection)
                  }
                  size="sm"
                  variant="outline"
                >
                  {t("agentAccessRevokeSelected")}
                </Button>
              )}
              columns={accessColumns}
              data={groupedShares}
              enableRowSelection
              getRowId={(row) => `${row.principalType}:${row.principalId}`}
              minTableWidth={820}
              preferenceKey="managed-model-access"
              searchVisibility="always"
            />
          )}
        </PanelState>
      </div>
    </section>
  );
}

function ReadinessResult({
  report,
  t,
}: {
  report: ManagedModelReadiness;
  t: (key: MessageKey) => string;
}) {
  return (
    <div
      className={`rm-managed-model-readiness ${report.status === "ready" ? "is-ready" : "is-blocked"}`}
    >
      <div className="rm-managed-model-readiness__summary">
        <div className="flex min-w-0 items-center gap-2">
          {report.status === "ready" ? (
            <CircleCheck aria-hidden="true" size={18} />
          ) : (
            <CircleAlert aria-hidden="true" size={18} />
          )}
          <strong className="truncate">{report.principal.label}</strong>
        </div>
        <StatusBadge tone={report.status === "ready" ? "success" : "danger"}>
          {t(
            report.status === "ready"
              ? "managedModelReadinessReady"
              : "managedModelReadinessBlocked",
          )}
        </StatusBadge>
      </div>
      <p className="text-xs text-muted">
        {report.status === "ready"
          ? t("managedModelReadinessReadyDescription")
          : t("managedModelReadinessBlockedDescription")}
      </p>
      <div className="rm-managed-model-readiness__checks">
        {report.checks.map((check) => (
          <details
            className={`rm-managed-model-readiness__check is-${check.status}`}
            key={check.key}
            open={check.status === "blocked"}
          >
            <summary>
              {check.status === "ready" ? (
                <CircleCheck aria-hidden="true" size={15} />
              ) : (
                <CircleAlert aria-hidden="true" size={15} />
              )}
              <span>{t(readinessKey(check.key))}</span>
              <small>{check.message}</small>
            </summary>
            {check.issues.length > 0 ? (
              <ul>
                {check.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </details>
        ))}
      </div>
    </div>
  );
}

function readinessKey(
  key: ManagedModelReadiness["checks"][number]["key"],
): MessageKey {
  const keys: Record<typeof key, MessageKey> = {
    principal: "managedModelReadinessPrincipal",
    workspace: "managedModelReadinessWorkspace",
    assistant_access: "managedModelReadinessAssistant",
    published_version: "managedModelReadinessPublished",
    base_model: "managedModelReadinessModel",
    provider: "managedModelReadinessProvider",
    knowledge: "managedModelReadinessKnowledge",
    tools: "managedModelReadinessTools",
    voice: "managedModelReadinessVoice",
  };
  return keys[key];
}

function permissionMessageKey(permission: AgentPermission): MessageKey {
  if (permission === "read") return "agentPermissionRead";
  if (permission === "run") return "agentPermissionRun";
  return "agentPermissionWrite";
}

function targetKey(target: ShareTarget): string {
  return `${target.principalType}:${target.principalId}`;
}
