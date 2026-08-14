import { Button, Select } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { shareTargetsQueryOptions, type ShareTarget } from "../features";
import type { AccessGrant, SharePrincipal } from "../features/access/api";
import {
  grantResourceMutationOptions,
  revokeResourceGrantMutationOptions,
} from "../features/access/mutation-options";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { safeUserErrorMessage } from "../lib/safe-user-error";

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
  queryKey: readonly unknown[];
}) {
  const { t } = useLocale();
  const [targetKey, setTargetKey] = useState("");
  const targetsQuery = useQuery(
    shareTargetsQueryOptions({ context: "access-editor" }),
  );
  const targets = targetsQuery.data ?? [];
  const grantMutation = useMutation(
    grantResourceMutationOptions({ mutationFn: onGrant, queryKey }),
  );
  const revokeMutation = useMutation(
    revokeResourceGrantMutationOptions({ mutationFn: onRevoke, queryKey }),
  );
  const selected = targets.find(
    (target) => shareTargetKey(target) === targetKey,
  );

  async function handleGrant() {
    if (selected === undefined) return;
    try {
      await grantMutation.mutateAsync({
        principalType: selected.principalType,
        principalId: selected.principalId,
        permissions: permissionOptions,
      });
      toast(t("accessGrantSaved"), "success");
    } catch (caught) {
      toast(safeUserErrorMessage(caught, t("accessGrantFailed")), "error");
    }
  }

  async function handleRevoke(grantId: string) {
    try {
      await revokeMutation.mutateAsync(grantId);
      toast(t("accessGrantRevoked"), "success");
    } catch (caught) {
      toast(safeUserErrorMessage(caught, t("accessRevokeFailed")), "error");
    }
  }

  return (
    <div className="grid gap-3">
      <div className="cs-fields flex flex-wrap items-end gap-2">
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
      {/* Grants are an inventory, so they get the same bordered rows every
          other list in the console has — not bare text lines with a link. */}
      {grants.length === 0 ? (
        <p className="text-sm text-muted">{t("accessNoGrants")}</p>
      ) : (
        <ul className="rm-grant-list">
          {grants.map((grant) => (
            <li className="rm-grant-row" key={grant.id}>
              <span className="rm-grant-row__copy">
                <span className="rm-grant-row__principal" translate="no">
                  {grant.principalId}
                </span>
                <span className="rm-grant-row__meta">
                  {grant.principalType} · {grant.permission}
                </span>
              </span>
              <Button
                disabled={revokeMutation.isPending}
                onClick={() => void handleRevoke(grant.id)}
                size="sm"
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
