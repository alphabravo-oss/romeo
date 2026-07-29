import { Input, NativeSelect, Button } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  disableUser,
  listUsers,
  setUserPassword,
  updateUserRole,
} from "../features/administration";
import type { User, UserRole } from "../features/administration";
import { PanelState } from "../lib/panel-state";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";

const userCol = createColumnHelper<User>();

const roleOptions: UserRole[] = ["user", "org_admin", "global_admin"];

export function UsersPanel() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const disableMutation = useMutation({ mutationFn: disableUser });
  const [managing, setManaging] = useState<User>();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  async function handleDisable(userId: string) {
    if (
      !(await ask({
        title: t("userDisableTitle"),
        body: t("userDisableImmediate"),
        confirmLabel: t("userDisable"),
        tone: "danger",
      }))
    )
      return;
    try {
      await disableMutation.mutateAsync(userId);
      await refresh();
      toast(t("userDisabledNotice"), "success");
    } catch {
      toast(t("userCouldNotDisable"), "error");
    }
  }

  const columns = useMemo<ColumnDef<User, any>[]>(
    () => [
      userCol.accessor("name", {
        header: t("userName"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      userCol.accessor("email", {
        header: t("userEmail"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      userCol.accessor("role", {
        header: t("userRole"),
        cell: (c) => (
          <span className="rm-cell-muted">{t(roleKey(c.getValue()))}</span>
        ),
      }),
      userCol.accessor(
        (row) => (row.disabledAt ? t("userDisabled") : t("userActive")),
        {
          id: "status",
          header: t("userStatus"),
          cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
        },
      ),
      userCol.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <div className="flex justify-end gap-2">
            <Button onClick={() => setManaging(c.row.original)} type="button">
              {t("userManage")}
            </Button>
            <Button
              variant="danger"
              disabled={
                disableMutation.isPending ||
                c.row.original.disabledAt !== undefined
              }
              onClick={() => void handleDisable(c.row.original.id)}
              type="button"
            >
              {t("userDisable")}
            </Button>
          </div>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disableMutation.isPending, t],
  );

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("userUsers")}</div>
        <Button
          disabled={usersQuery.isFetching}
          onClick={() => void usersQuery.refetch()}
          type="button"
        >
          {usersQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
      </div>
      <div className="mt-4">
        <PanelState query={usersQuery} empty={t("userNoUsers")}>
          {(users) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: t("userTotalUsers"), value: users.length },
                  {
                    label: t("userAdmins"),
                    value: users.filter((u) => u.role !== "user").length,
                  },
                  {
                    label: t("userDisabled"),
                    value: users.filter((u) => u.disabledAt).length,
                  },
                ]}
              />
              <DataTable
                columns={columns}
                data={users}
                empty={t("userNoUsers")}
              />
            </div>
          )}
        </PanelState>
      </div>
      {managing !== undefined ? (
        <UserManageDialog
          key={managing.id}
          onChanged={() => void refresh()}
          onClose={() => setManaging(undefined)}
          user={managing}
        />
      ) : null}
      {dialog}
    </section>
  );
}

function UserManageDialog({
  user,
  onClose,
  onChanged,
}: {
  user: User;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [role, setRole] = useState<UserRole>(user.role);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const roleMutation = useMutation({ mutationFn: updateUserRole });
  const passwordMutation = useMutation({ mutationFn: setUserPassword });

  async function saveRole() {
    try {
      await roleMutation.mutateAsync({ userId: user.id, role });
      onChanged();
      toast(t("userRoleUpdated"), "success");
    } catch {
      toast(t("userCouldNotUpdateRole"), "error");
    }
  }

  async function savePassword() {
    if (newPassword.length < 12) {
      toast(t("userPasswordMinimum"), "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast(t("userPasswordsDoNotMatch"), "error");
      return;
    }
    try {
      await passwordMutation.mutateAsync({ userId: user.id, newPassword });
      toast(t("userPasswordSet"), "success");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      toast(t("userCouldNotSetPassword"), "error");
    }
  }

  return (
    <FormDialog
      description={user.email}
      onClose={onClose}
      open
      title={t("userManageTitle")}
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">{t("userRole")}</span>
            <NativeSelect
              onChange={(event) =>
                setRole(event.currentTarget.value as UserRole)
              }
              value={role}
            >
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {t(roleKey(option))}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button
            variant="primary"
            disabled={role === user.role || roleMutation.isPending}
            onClick={() => void saveRole()}
            type="button"
          >
            {roleMutation.isPending ? t("saving") : t("userUpdateRole")}
          </Button>
        </div>
        <div className="grid gap-2 border-t border-border pt-4">
          <div className="text-sm font-medium">{t("userSetLocalPassword")}</div>
          <div className="text-xs text-muted">
            {t("userLocalPasswordGuidance")}
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">{t("userNewPassword")}</span>
            <Input
              autoComplete="new-password"
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              type="password"
              value={newPassword}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">{t("userConfirmPassword")}</span>
            <Input
              autoComplete="new-password"
              onChange={(event) =>
                setConfirmPassword(event.currentTarget.value)
              }
              type="password"
              value={confirmPassword}
            />
          </label>
          <Button
            disabled={passwordMutation.isPending || newPassword.length < 12}
            onClick={() => void savePassword()}
            type="button"
          >
            {passwordMutation.isPending ? t("saving") : t("userSetPassword")}
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}

function roleKey(
  role: UserRole,
): "userGlobalAdmin" | "userOrgAdmin" | "userUser" {
  if (role === "global_admin") return "userGlobalAdmin";
  if (role === "org_admin") return "userOrgAdmin";
  return "userUser";
}
