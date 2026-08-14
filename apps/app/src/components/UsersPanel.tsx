import { Input, LinkButton, NativeSelect, Button } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import { useCallback, useMemo, useState } from "react";

import {
  disableUserMutationOptions,
  usersQueryOptions,
  setUserPasswordMutationOptions,
  updateUserRoleMutationOptions,
} from "../features/administration";
import type { User, UserRole } from "../features/administration";
import { PanelState } from "../lib/panel-state";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { IdentityCell, Section, StatRow } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { confirmTone } from "./danger-tier";
import { FormDialog } from "./FormDialog";
import { PageActions } from "./PageActions";
import { canDisableUser } from "./user-disable-guard";

const userCol = createColumnHelper<User>();

const roleOptions: UserRole[] = ["user", "org_admin", "global_admin"];
const pageSize = 50;

type UserSort = "email" | "name" | "role" | "status";

interface UsersPanelProps {
  direction: "asc" | "desc";
  onNavigationChange: (next: {
    direction?: "asc" | "desc";
    page?: number;
    query?: string;
    sort?: UserSort;
  }) => void;
  page: number;
  query: string;
  sort: UserSort;
}

export function UsersPanel({
  direction,
  onNavigationChange,
  page,
  query,
  sort,
}: UsersPanelProps) {
  const { t } = useLocale();
  const { ask, dialog } = useConfirm();
  const usersQuery = useQuery(
    usersQueryOptions({ direction, page, pageSize, query, sort }),
  );
  const disableMutation = useMutation(disableUserMutationOptions());
  const [managing, setManaging] = useState<User>();

  const handleDisable = useCallback(
    async (user: User) => {
      if (
        !(await ask({
          title: t("usersDisableConfirmTitle"),
          body: t("usersDisableConfirmBody"),
          confirmLabel: t("userDisable"),
          tone: confirmTone("medium"),
        }))
      )
        return;
      try {
        await disableMutation.mutateAsync(user.id);
        toast(t("userDisabledNotice"), "success");
      } catch {
        toast(t("userCouldNotDisable"), "error");
      }
    },
    [ask, disableMutation, t],
  );

  const columns = useMemo<ColumnDef<User, any>[]>(
    () => [
      userCol.accessor("name", {
        header: t("userName"),
        cell: (c) => (
          <IdentityCell
            mono
            primary={c.getValue()}
            secondary={c.row.original.email}
          />
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
        cell: (c) => {
          const canDisable = canDisableUser(
            disableGuardEntry(c.row.original),
            usersQuery.data?.meta.activeGlobalAdminTotal ?? 0,
          );
          const isDisabled = c.row.original.disabledAt !== undefined;

          return (
            <div className="flex items-center justify-end gap-2">
              {!canDisable && !isDisabled ? (
                <span className="text-xs text-muted">
                  {t("usersLastAdminHint")}
                </span>
              ) : null}
              <Button onClick={() => setManaging(c.row.original)} type="button">
                {t("userManage")}
              </Button>
              <Button
                aria-haspopup="dialog"
                disabled={
                  disableMutation.isPending || isDisabled || !canDisable
                }
                onClick={() => void handleDisable(c.row.original)}
                size="sm"
                type="button"
                variant="secondary"
              >
                {t("userDisable")}
              </Button>
            </div>
          );
        },
      }),
    ],
    [
      disableMutation.isPending,
      handleDisable,
      t,
      usersQuery.data?.meta.activeGlobalAdminTotal,
    ],
  );
  const sorting = useMemo(
    () => [{ id: sort, desc: direction === "desc" }],
    [direction, sort],
  );

  return (
    <Section
      actions={
        <PageActions
          onRefresh={() => void usersQuery.refetch()}
          primary={
            <LinkButton href="/admin?section=auth-providers" variant="primary">
              {t("usersAddViaSso")}
            </LinkButton>
          }
          refreshLabel={t("refresh")}
          refreshing={usersQuery.isFetching}
        />
      }
      description={t("usersAddViaSsoHint")}
      title={t("userDirectory")}
    >
      <label className="rm-model-search" htmlFor="user-search">
        <Search aria-hidden="true" size={15} />
        <Input
          aria-label={t("tableSearch")}
          id="user-search"
          name="userSearch"
          onChange={(event) =>
            onNavigationChange({
              page: 0,
              query: event.currentTarget.value,
            })
          }
          placeholder={t("tableSearchPlaceholder")}
          value={query}
        />
      </label>
      <PanelState
        query={usersQuery}
        empty={t("userNoUsers")}
        isEmpty={() => false}
      >
        {(userPage) => (
          <div className="grid gap-4">
            <StatRow
              items={[
                {
                  label: t("userTotalUsers"),
                  value: userPage.meta.userTotal,
                },
                { label: t("userAdmins"), value: userPage.meta.adminTotal },
                {
                  label: t("userDisabled"),
                  value: userPage.meta.disabledTotal,
                },
              ]}
            />
            <DataTable
              columns={columns}
              data={userPage.data}
              empty={t("userNoUsers")}
              manualFiltering
              manualSorting
              onSortingChange={(updater) => {
                const next =
                  typeof updater === "function" ? updater(sorting) : updater;
                const first = next[0];
                const nextSort = (
                  ["email", "name", "role", "status"].includes(first?.id ?? "")
                    ? first!.id
                    : "name"
                ) as UserSort;
                onNavigationChange({
                  direction: first?.desc === true ? "desc" : "asc",
                  page: 0,
                  sort: nextSort,
                });
              }}
              preferenceKey="admin-users"
              searchVisibility="hidden"
              serverPagination={{
                pageSize,
                hasNextPage: userPage.meta.hasMore,
                isFetching: usersQuery.isFetching,
                onNextPage: () => onNavigationChange({ page: page + 1 }),
                ...(page > 0
                  ? {
                      onPrevPage: () => onNavigationChange({ page: page - 1 }),
                    }
                  : {}),
              }}
              sorting={sorting}
            />
          </div>
        )}
      </PanelState>
      {managing !== undefined ? (
        <UserManageDialog
          key={managing.id}
          onClose={() => setManaging(undefined)}
          user={managing}
        />
      ) : null}
      {dialog}
    </Section>
  );
}

function UserManageDialog({
  user,
  onClose,
}: {
  user: User;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [role, setRole] = useState<UserRole>(user.role);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const roleMutation = useMutation(updateUserRoleMutationOptions());
  const passwordMutation = useMutation(setUserPasswordMutationOptions());

  async function saveRole() {
    try {
      await roleMutation.mutateAsync({ userId: user.id, role });
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
    } finally {
      passwordMutation.reset();
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

function disableGuardEntry(user: User): {
  id: string;
  role: string;
  status: string;
} {
  return {
    id: user.id,
    role: user.role,
    status: user.disabledAt === undefined ? "active" : "disabled",
  };
}
