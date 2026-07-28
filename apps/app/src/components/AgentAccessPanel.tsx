import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button, Checkbox, Input, Select } from "@romeo/ui";

import { listShareTargets } from "../features";
import type { ShareTarget } from "../features/types";
import { listAgentShares, shareAgentAccess } from "../features/managed-models";
import type { Agent, AgentGrant } from "../features/managed-models";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";

type AgentPermission = "read" | "run" | "write";

const defaultPermissions: Record<AgentPermission, boolean> = {
  read: true,
  run: true,
  write: false,
};
const emptyTargets: ShareTarget[] = [];

export function AgentAccessPanel({
  activeAgent,
  onNotice,
}: {
  activeAgent: Agent | undefined;
  onNotice: (notice: string | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [selectedTargetKey, setSelectedTargetKey] = useState("");
  const [permissions, setPermissions] = useState(defaultPermissions);

  const targetsQuery = useQuery({
    queryKey: ["shareTargets", query],
    queryFn: () => listShareTargets(query),
  });
  const sharesQuery = useQuery({
    queryKey: ["agentShares", activeAgent?.id],
    queryFn: () => listAgentShares(activeAgent!.id),
    enabled: activeAgent !== undefined,
  });
  const shareMutation = useMutation({ mutationFn: shareAgentAccess });
  const targets = targetsQuery.data ?? emptyTargets;
  const selectedTarget = targets.find(
    (target) => targetKey(target) === selectedTargetKey,
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
      onNotice(t("agentAccessUpdated"));
      toast(t("agentAccessGranted"), "success");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["agentShares", activeAgent.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["agentGallery"] }),
        queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
      ]);
    } catch {
      toast(t("agentCouldNotGrantAccess"), "error");
    }
  }

  function togglePermission(permission: AgentPermission) {
    setPermissions((current) => ({
      ...current,
      [permission]: !current[permission],
    }));
  }

  return (
    <div
      className="mt-4 grid gap-3 border-t border-border pt-4"
      data-testid="agent-access-panel"
    >
      <div className="text-sm text-muted">{t("agentAccess")}</div>
      <div className="grid gap-2 text-sm">
        <Input
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("agentSearchShareTargets")}
          value={query}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Select
            disabled={targets.length === 0}
            onValueChange={setSelectedTargetKey}
            options={targets.map((target) => ({
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
      </div>
      <div className="grid gap-2 text-sm">
        <PanelState query={sharesQuery} empty={t("agentNoAccessGrants")}>
          {(shares) =>
            groupShares(shares)
              .slice(0, 6)
              .map((share) => (
                <div
                  className="rounded-md border border-border p-2"
                  key={`${share.principalType}:${share.principalId}`}
                >
                  <div className="break-all font-medium">
                    {share.principalId}
                  </div>
                  <div className="text-muted">
                    {share.permissions
                      .map((permission) => permissionLabel(permission, t))
                      .join(", ")}
                  </div>
                </div>
              ))
          }
        </PanelState>
      </div>
    </div>
  );
}

function permissionMessageKey(permission: AgentPermission): MessageKey {
  if (permission === "read") return "agentPermissionRead";
  if (permission === "run") return "agentPermissionRun";
  return "agentPermissionWrite";
}

function permissionLabel(
  permission: string,
  t: (key: MessageKey) => string,
): string {
  return permission === "read" || permission === "run" || permission === "write"
    ? t(permissionMessageKey(permission))
    : permission;
}

function targetKey(target: ShareTarget): string {
  return `${target.principalType}:${target.principalId}`;
}

function groupShares(grants: AgentGrant[]): Array<{
  principalType: string;
  principalId: string;
  permissions: string[];
}> {
  const grouped = new Map<
    string,
    { principalType: string; principalId: string; permissions: string[] }
  >();
  for (const grant of grants) {
    const key = `${grant.principalType}:${grant.principalId}`;
    const existing = grouped.get(key) ?? {
      principalType: grant.principalType,
      principalId: grant.principalId,
      permissions: [],
    };
    existing.permissions.push(grant.permission);
    grouped.set(key, existing);
  }
  return [...grouped.values()]
    .map((share) => ({
      ...share,
      permissions: [...new Set(share.permissions)].sort(),
    }))
    .sort(
      (left, right) =>
        left.principalType.localeCompare(right.principalType) ||
        left.principalId.localeCompare(right.principalId),
    );
}
