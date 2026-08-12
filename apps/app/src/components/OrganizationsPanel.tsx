import { Button, Input, StatusBadge } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  buildCreateTenantOrganizationBody,
  createTenantOrganization,
  isValidTenantReasonCode,
  listTenantOrganizations,
  reactivateTenantOrganization,
  suspendTenantOrganization,
  type TenantOrganizationSummary,
  updateTenantOrganization,
} from "../features/tenant-administration";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime, LocalizedNumber } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { AddButton, Section, StatRow } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { OverflowMenu } from "./OverflowMenu";
import { PageActions } from "./PageActions";

const orgCol = createColumnHelper<TenantOrganizationSummary>();

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; row: TenantOrganizationSummary }
  | { kind: "suspend"; row: TenantOrganizationSummary }
  | null;

export function OrganizationsPanel() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [reasonCode, setReasonCode] = useState("admin_ui_suspend");
  const [formError, setFormError] = useState("");

  const organizationsQuery = useQuery({
    queryKey: ["admin-organizations"],
    queryFn: listTenantOrganizations,
  });

  const createMutation = useMutation({ mutationFn: createTenantOrganization });
  const updateMutation = useMutation({ mutationFn: updateTenantOrganization });
  const suspendMutation = useMutation({
    mutationFn: suspendTenantOrganization,
  });
  const reactivateMutation = useMutation({
    mutationFn: reactivateTenantOrganization,
  });

  const rows = organizationsQuery.data ?? [];
  const suspendedCount = rows.filter((row) => row.suspension.suspended).length;

  function openCreate() {
    setName("");
    setSlug("");
    setWorkspaceName("");
    setAdminEmail("");
    setAdminName("");
    setAdminPassword("");
    setFormError("");
    setDialog({ kind: "create" });
  }

  function openEdit(row: TenantOrganizationSummary) {
    setName(row.organization.name);
    setSlug(row.organization.slug);
    setFormError("");
    setDialog({ kind: "edit", row });
  }

  function openSuspend(row: TenantOrganizationSummary) {
    setReasonCode("admin_ui_suspend");
    setFormError("");
    setDialog({ kind: "suspend", row });
  }

  async function invalidateList() {
    await queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
  }

  async function handleReactivate(row: TenantOrganizationSummary) {
    const confirmed = await ask({
      title: t("organizationsReactivateTitle"),
      body: t("organizationsReactivateBody", {
        name: row.organization.name,
      }),
      confirmLabel: t("organizationsReactivate"),
    });
    if (!confirmed) return;
    try {
      await reactivateMutation.mutateAsync(row.organization.id);
      await invalidateList();
      toast(t("organizationsReactivated"), "success");
    } catch {
      toast(t("organizationsReactivateFailed"), "error");
    }
  }

  const columns = useMemo<ColumnDef<TenantOrganizationSummary, any>[]>(
    () => [
      orgCol.accessor((row) => row.organization.name, {
        id: "name",
        header: t("organizationsName"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      orgCol.accessor((row) => row.organization.slug, {
        id: "slug",
        header: t("organizationsSlug"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      orgCol.accessor((row) => row.organization.id, {
        id: "id",
        header: t("organizationsId"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      orgCol.accessor((row) => row.suspension.suspended, {
        id: "status",
        header: t("organizationsStatus"),
        cell: (c) =>
          c.getValue() ? (
            <StatusBadge tone="warning">
              {t("organizationsSuspended")}
            </StatusBadge>
          ) : (
            <StatusBadge tone="success">{t("organizationsActive")}</StatusBadge>
          ),
      }),
      orgCol.accessor((row) => row.counts.users, {
        id: "users",
        header: t("organizationsUsers"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedNumber value={c.getValue()} />
          </span>
        ),
      }),
      orgCol.accessor((row) => row.counts.workspaces, {
        id: "workspaces",
        header: t("organizationsWorkspaces"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedNumber value={c.getValue()} />
          </span>
        ),
      }),
      orgCol.accessor((row) => row.suspension.suspendedAt ?? "", {
        id: "suspendedAt",
        header: t("organizationsSuspendedAt"),
        cell: (c) => {
          const value = c.getValue();
          return value ? (
            <span className="rm-cell-muted">
              <LocalizedDateTime value={value} />
            </span>
          ) : (
            <span className="rm-cell-muted">—</span>
          );
        },
      }),
      orgCol.display({
        id: "actions",
        header: "",
        cell: (c) => {
          const row = c.row.original;
          const suspended = row.suspension.suspended;
          return (
            <div className="flex justify-end">
              <OverflowMenu
                items={[
                  {
                    label: t("organizationsEdit"),
                    onClick: () => openEdit(row),
                  },
                  suspended
                    ? {
                        label: t("organizationsReactivate"),
                        onClick: () => void handleReactivate(row),
                      }
                    : {
                        label: t("organizationsSuspend"),
                        onClick: () => openSuspend(row),
                        tone: "danger",
                      },
                ]}
                label={`${t("organizationsActionsFor")} ${row.organization.name}`}
              />
            </div>
          );
        },
      }),
    ],
    [t],
  );

  return (
    <Section
      actions={
        <PageActions
          onRefresh={() => void organizationsQuery.refetch()}
          primary={
            <AddButton onClick={openCreate}>
              {t("organizationsCreate")}
            </AddButton>
          }
          refreshLabel={t("refresh")}
          refreshing={organizationsQuery.isFetching}
        />
      }
      title={t("organizationsTitle")}
    >
      <StatRow
        items={[
          {
            label: t("organizationsTotal"),
            value: rows.length,
          },
          {
            label: t("organizationsActiveCount"),
            value: rows.length - suspendedCount,
          },
          {
            label: t("organizationsSuspendedCount"),
            value: suspendedCount,
          },
        ]}
      />

      <DataTable columns={columns} data={rows} empty={t("organizationsNone")} />

      <FormDialog
        className="rm-form-dialog--sm"
        description={t("organizationsCreateDescription")}
        onClose={() => setDialog(null)}
        open={dialog?.kind === "create"}
        title={t("organizationsCreate")}
      >
        <form
          className="rm-form-dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length === 0) {
              setFormError(t("organizationsNameRequired"));
              return;
            }
            const body = buildCreateTenantOrganizationBody({
              name,
              slug,
              defaultWorkspaceName: workspaceName,
              initialAdminEmail: adminEmail,
              initialAdminName: adminName,
              initialAdminPassword: adminPassword,
            });
            if (
              (adminEmail.trim() || adminName.trim() || adminPassword.trim()) &&
              !(adminEmail.trim() && adminName.trim())
            ) {
              setFormError(t("organizationsAdminPairRequired"));
              return;
            }
            setFormError("");
            void createMutation
              .mutateAsync(body)
              .then(async () => {
                await invalidateList();
                toast(t("organizationsCreated"), "success");
                setDialog(null);
              })
              .catch(() => {
                setFormError(t("organizationsCreateFailed"));
                toast(t("organizationsCreateFailed"), "error");
              });
          }}
        >
          <label className="rm-form-field" htmlFor="org-create-name">
            <span>{t("organizationsName")}</span>
            <Input
              autoFocus
              id="org-create-name"
              onChange={(e) => setName(e.currentTarget.value)}
              required
              value={name}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-create-slug">
            <span>{t("organizationsSlugOptional")}</span>
            <Input
              id="org-create-slug"
              onChange={(e) => setSlug(e.currentTarget.value)}
              value={slug}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-create-ws">
            <span>{t("organizationsDefaultWorkspaceOptional")}</span>
            <Input
              id="org-create-ws"
              onChange={(e) => setWorkspaceName(e.currentTarget.value)}
              value={workspaceName}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-create-admin-email">
            <span>{t("organizationsInitialAdminEmailOptional")}</span>
            <Input
              id="org-create-admin-email"
              onChange={(e) => setAdminEmail(e.currentTarget.value)}
              type="email"
              value={adminEmail}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-create-admin-name">
            <span>{t("organizationsInitialAdminNameOptional")}</span>
            <Input
              id="org-create-admin-name"
              onChange={(e) => setAdminName(e.currentTarget.value)}
              value={adminName}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-create-admin-password">
            <span>{t("organizationsInitialAdminPasswordOptional")}</span>
            <Input
              id="org-create-admin-password"
              onChange={(e) => setAdminPassword(e.currentTarget.value)}
              type="password"
              value={adminPassword}
            />
          </label>
          {formError ? (
            <p className="rm-form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="rm-form-actions">
            <Button
              onClick={() => setDialog(null)}
              type="button"
              variant="ghost"
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={createMutation.isPending || name.trim().length === 0}
              type="submit"
              variant="primary"
            >
              {createMutation.isPending
                ? t("organizationsCreating")
                : t("organizationsCreate")}
            </Button>
          </div>
        </form>
      </FormDialog>

      <FormDialog
        className="rm-form-dialog--sm"
        description={t("organizationsEditDescription")}
        onClose={() => setDialog(null)}
        open={dialog?.kind === "edit"}
        title={t("organizationsEdit")}
      >
        <form
          className="rm-form-dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog?.kind !== "edit") return;
            const nextName = name.trim();
            const nextSlug = slug.trim();
            if (nextName.length === 0 || nextSlug.length === 0) {
              setFormError(t("organizationsNameSlugRequired"));
              return;
            }
            setFormError("");
            void updateMutation
              .mutateAsync({
                orgId: dialog.row.organization.id,
                body: { name: nextName, slug: nextSlug },
              })
              .then(async () => {
                await invalidateList();
                toast(t("organizationsUpdated"), "success");
                setDialog(null);
              })
              .catch(() => {
                setFormError(t("organizationsUpdateFailed"));
                toast(t("organizationsUpdateFailed"), "error");
              });
          }}
        >
          <label className="rm-form-field" htmlFor="org-edit-name">
            <span>{t("organizationsName")}</span>
            <Input
              autoFocus
              id="org-edit-name"
              onChange={(e) => setName(e.currentTarget.value)}
              value={name}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-edit-slug">
            <span>{t("organizationsSlug")}</span>
            <Input
              id="org-edit-slug"
              onChange={(e) => setSlug(e.currentTarget.value)}
              value={slug}
            />
          </label>
          {formError ? (
            <p className="rm-form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="rm-form-actions">
            <Button
              onClick={() => setDialog(null)}
              type="button"
              variant="ghost"
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={updateMutation.isPending}
              type="submit"
              variant="primary"
            >
              {updateMutation.isPending
                ? t("organizationsSaving")
                : t("organizationsSave")}
            </Button>
          </div>
        </form>
      </FormDialog>

      <FormDialog
        className="rm-form-dialog--sm"
        description={t("organizationsSuspendDescription")}
        onClose={() => setDialog(null)}
        open={dialog?.kind === "suspend"}
        title={t("organizationsSuspendTitle")}
      >
        <form
          className="rm-form-dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog?.kind !== "suspend") return;
            if (!isValidTenantReasonCode(reasonCode)) {
              setFormError(t("organizationsReasonInvalid"));
              return;
            }
            setFormError("");
            void suspendMutation
              .mutateAsync({
                orgId: dialog.row.organization.id,
                reasonCode: reasonCode.trim(),
              })
              .then(async () => {
                await invalidateList();
                toast(t("organizationsSuspendedToast"), "success");
                setDialog(null);
              })
              .catch(() => {
                setFormError(t("organizationsSuspendFailed"));
                toast(t("organizationsSuspendFailed"), "error");
              });
          }}
        >
          <p className="rm-form-hint">
            {t("organizationsSuspendConfirm", {
              name:
                dialog?.kind === "suspend" ? dialog.row.organization.name : "",
              id: dialog?.kind === "suspend" ? dialog.row.organization.id : "",
            })}
          </p>
          <label className="rm-form-field" htmlFor="org-suspend-reason">
            <span>{t("organizationsReasonCode")}</span>
            <Input
              autoFocus
              id="org-suspend-reason"
              onChange={(e) => setReasonCode(e.currentTarget.value)}
              value={reasonCode}
            />
          </label>
          {formError ? (
            <p className="rm-form-error" role="alert">
              {formError}
            </p>
          ) : (
            <p className="rm-form-hint">{t("organizationsReasonHint")}</p>
          )}
          <div className="rm-form-actions">
            <Button
              onClick={() => setDialog(null)}
              type="button"
              variant="ghost"
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={suspendMutation.isPending}
              type="submit"
              variant="danger"
            >
              {suspendMutation.isPending
                ? t("organizationsSuspending")
                : t("organizationsSuspend")}
            </Button>
          </div>
        </form>
      </FormDialog>

      {confirmDialog}
    </Section>
  );
}
