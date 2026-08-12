import { Button, Select } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { listShareTargets, type ShareTarget } from "../features";
import type { AccessGrant, SharePrincipal } from "../features/access/api";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";

export function ResourceGrantEditor({
  grants,
  onGrant,
  onRevoke,
  permissionOptions,
  queryKey,
}: {
  grants: AccessGrant[];
  onGrant: (share: SharePrincipal) => Promise<unknown>;
  onRevoke: (grantId: string) => Promise<unknown>;
  permissionOptions: Array<"read" | "write" | "use" | "run">;
  queryKey: unknown[];
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [targetKey, setTargetKey] = useState("");
  const targetsQuery = useQuery({
    queryKey: ["shareTargets", "access-editor"],
    queryFn: () => listShareTargets(),
  });
  const targets = targetsQuery.data ?? [];
  const grantMutation = useMutation({ mutationFn: onGrant });
  const revokeMutation = useMutation({ mutationFn: onRevoke });
  const selected = useMemo(
    () => targets.find((target) => shareTargetKey(target) === targetKey),
    [targetKey, targets],
  );

  async function handleGrant() {
    if (selected === undefined) return;
    try {
      await grantMutation.mutateAsync({
        principalType: selected.principalType,
        principalId: selected.principalId,
        permissions: permissionOptions,
      });
      await queryClient.invalidateQueries({ queryKey });
      toast(t("accessGrantSaved"), "success");
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : t("accessGrantFailed"),
        "error",
      );
    }
  }

  async function handleRevoke(grantId: string) {
    try {
      await revokeMutation.mutateAsync(grantId);
      await queryClient.invalidateQueries({ queryKey });
      toast(t("accessGrantRevoked"), "success");
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : t("accessRevokeFailed"),
        "error",
      );
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Select
            name="access-principal"
            onValueChange={setTargetKey}
            options={targets.map((target) => ({
              label: `${target.label} (${target.principalType})`,
              value: shareTargetKey(target),
            }))}
            value={targetKey}
          />
        </div>
        <Button
          disabled={selected === undefined || grantMutation.isPending}
          onClick={() => void handleGrant()}
          type="button"
          variant="primary"
        >
          {t("accessGrant")}
        </Button>
      </div>
      {grants.length === 0 ? (
        <p className="text-sm text-muted">{t("accessNoGrants")}</p>
      ) : (
        <ul className="grid gap-2">
          {grants.map((grant) => (
            <li
              className="flex items-center justify-between gap-2 text-sm"
              key={grant.id}
            >
              <span>
                {grant.principalType} · {grant.principalId} · {grant.permission}
              </span>
              <Button
                disabled={revokeMutation.isPending}
                onClick={() => void handleRevoke(grant.id)}
                type="button"
                variant="ghost"
              >
                {t("accessRevoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function shareTargetKey(target: ShareTarget): string {
  return `${target.principalType}:${target.principalId}`;
}
