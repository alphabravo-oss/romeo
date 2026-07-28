import { Button, Input, NativeSelect, Textarea } from "@romeo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  triggerDirectorySync,
  type DirectorySyncResult,
} from "../features/administration";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { useConfirm } from "./ConfirmDialog";
import {
  DIRECTORY_SYNC_SOURCES,
  buildDirectorySyncRequest,
  defaultDirectorySyncForm,
  type DirectorySyncForm,
} from "./directory-sync-request";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";

export function AuthDirectorySyncDialog(props: { onClose: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const [syncForm, setSyncForm] = useState<DirectorySyncForm>(
    defaultDirectorySyncForm,
  );
  const [syncPreview, setSyncPreview] = useState<DirectorySyncResult | null>(
    null,
  );
  const syncMutation = useMutation({ mutationFn: triggerDirectorySync });

  function setSync<K extends keyof DirectorySyncForm>(
    key: K,
    value: DirectorySyncForm[K],
  ): void {
    setSyncForm((current) => ({ ...current, [key]: value }));
    setSyncPreview(null);
  }

  async function handleSyncPreview(): Promise<void> {
    const built = buildDirectorySyncRequest(syncForm, { apply: false });
    if (!built.ok) {
      toast(built.error, "error");
      return;
    }
    try {
      setSyncPreview(await syncMutation.mutateAsync(built.request));
    } catch {
      toast(t("authDirectorySyncPreviewFailed"), "error");
    }
  }

  async function handleSyncApply(): Promise<void> {
    if (syncPreview === null) return;
    const confirmed = await ask({
      title: t("authApplyDirectorySyncTitle"),
      body: `${t("authThisDisables")} ${syncPreview.changes.userDisables.count} ${t("authUsersAndRemoves")} ${syncPreview.changes.membershipRemovals.count} ${t("authGroupMembershipsCannotUndo")}`,
      confirmLabel: t("authApplyChanges"),
      tone: "danger",
    });
    if (!confirmed) return;
    const built = buildDirectorySyncRequest(syncForm, { apply: true });
    if (!built.ok) {
      toast(built.error, "error");
      return;
    }
    try {
      const result = await syncMutation.mutateAsync(built.request);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      toast(
        `${t("authDirectorySyncApplied")} — ${result.changes.userDisables.count} ${t("authDisabledLower")}, ${result.changes.membershipRemovals.count} ${t("authMembershipsRemoved")}`,
        "success",
      );
      props.onClose();
    } catch {
      toast(t("authDirectorySyncFailed"), "error");
    }
  }

  return (
    <>
      <FormDialog
        description={t("authDirectorySyncDescription")}
        onClose={props.onClose}
        open
        title={t("authDirectorySync")}
      >
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">{t("authSource")}</span>
            <NativeSelect
              onChange={(event) =>
                setSync(
                  "source",
                  event.currentTarget.value as DirectorySyncForm["source"],
                )
              }
              value={syncForm.source}
            >
              {DIRECTORY_SYNC_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </NativeSelect>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-muted">{t("authPresentUsersEmails")}</span>
            <Textarea
              onChange={(event) =>
                setSync("presentUserEmails", event.currentTarget.value)
              }
              placeholder={t("authPresentUsersPlaceholder")}
              rows={3}
              value={syncForm.presentUserEmails}
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-muted">{t("authGroupMemberships")}</span>
            <Textarea
              onChange={(event) =>
                setSync("groupMemberships", event.currentTarget.value)
              }
              placeholder={t("authGroupMembershipsPlaceholder")}
              rows={3}
              value={syncForm.groupMemberships}
            />
          </label>

          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Input
                checked={syncForm.disableMissingUsers}
                onChange={(event) =>
                  setSync("disableMissingUsers", event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>{t("authDisableMissingUsers")}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Input
                checked={syncForm.removeMissingGroupMembers}
                onChange={(event) =>
                  setSync(
                    "removeMissingGroupMembers",
                    event.currentTarget.checked,
                  )
                }
                type="checkbox"
              />
              <span>{t("authRemoveMissingGroupMembers")}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Input
                checked={syncForm.preserveAdminUsers}
                onChange={(event) =>
                  setSync("preserveAdminUsers", event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>{t("authPreserveAdminUsers")}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Input
                checked={syncForm.allowAdminUserDisable}
                onChange={(event) =>
                  setSync("allowAdminUserDisable", event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>{t("authAllowAdminDisable")}</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-sm">
              <span className="text-muted">{t("authMaxUserDisables")}</span>
              <Input
                onChange={(event) =>
                  setSync("maxUserDisables", event.currentTarget.value)
                }
                placeholder={t("authUnlimited")}
                type="number"
                value={syncForm.maxUserDisables}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted">
                {t("authMaxMembershipRemovals")}
              </span>
              <Input
                onChange={(event) =>
                  setSync("maxMembershipRemovals", event.currentTarget.value)
                }
                placeholder={t("authUnlimited")}
                type="number"
                value={syncForm.maxMembershipRemovals}
              />
            </label>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="text-muted">{t("authReasonOptional")}</span>
            <Input
              onChange={(event) => setSync("reason", event.currentTarget.value)}
              placeholder={t("authRecordedInAuditLog")}
              value={syncForm.reason}
            />
          </label>

          {syncPreview !== null ? (
            <div className="grid gap-2 border border-border rounded p-3">
              <div className="text-sm font-medium">{t("authPreviewPlan")}</div>
              <PanelStats
                items={[
                  {
                    label: t("authUsersToDisable"),
                    value: syncPreview.changes.userDisables.count,
                  },
                  {
                    label: t("authMembershipsToRemove"),
                    value: syncPreview.changes.membershipRemovals.count,
                  },
                  {
                    label: t("authWarnings"),
                    value: syncPreview.warnings.length,
                  },
                ]}
              />
              {syncPreview.warnings.length > 0 ? (
                <ul className="text-xs text-muted grid gap-1">
                  {syncPreview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              disabled={syncMutation.isPending}
              onClick={() => void handleSyncPreview()}
              type="button"
            >
              {syncMutation.isPending ? t("authWorking") : t("authPreview")}
            </Button>
            <Button
              variant="danger"
              disabled={syncPreview === null || syncMutation.isPending}
              onClick={() => void handleSyncApply()}
              type="button"
            >
              {t("authApplyChanges")}
            </Button>
          </div>
        </div>
      </FormDialog>
      {dialog}
    </>
  );
}
