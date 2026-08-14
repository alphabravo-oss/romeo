import { Button, Input } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import {
  buildCreateTenantOrganizationBody,
  createTenantOrganizationMutationOptions,
  isValidTenantReasonCode,
  tenantOrganizationsQueryOptions,
  reactivateTenantOrganizationMutationOptions,
  suspendTenantOrganizationMutationOptions,
  type TenantOrganizationSummary,
  updateTenantOrganizationMutationOptions,
} from "../features/tenant-administration";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { AddButton, Section, StatRow } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { DataTable } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { PageActions } from "./PageActions";
import { organizationColumns } from "./organization-columns";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; row: TenantOrganizationSummary }
  | { kind: "suspend"; row: TenantOrganizationSummary }
  | null;

export function OrganizationsPanel() {
  const { t } = useLocale();
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

  const organizationsQuery = useQuery(tenantOrganizationsQueryOptions());

  const createMutation = useMutation(createTenantOrganizationMutationOptions());
  const updateMutation = useMutation(updateTenantOrganizationMutationOptions());
  const suspendMutation = useMutation(
    suspendTenantOrganizationMutationOptions(),
  );
  const reactivateMutation = useMutation(
    reactivateTenantOrganizationMutationOptions(),
  );

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

  const handleReactivate = useCallback(
    async (row: TenantOrganizationSummary) => {
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
        toast(t("organizationsReactivated"), "success");
      } catch {
        toast(t("organizationsReactivateFailed"), "error");
      }
    },
    [ask, reactivateMutation, t],
  );

  const columns = useMemo(
    () =>
      organizationColumns({
        onEdit: openEdit,
        onReactivate: (row) => void handleReactivate(row),
        onSuspend: openSuspend,
        t,
      }),
    [handleReactivate, t],
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

      <DataTable
        columns={columns}
        data={rows}
        empty={t("organizationsNone")}
      />

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
              .then(() => {
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
              autoComplete="organization"
              id="org-create-name"
              name="organizationName"
              onChange={(e) => setName(e.currentTarget.value)}
              required
              value={name}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-create-slug">
            <span>{t("organizationsSlugOptional")}</span>
            <Input
              autoComplete="off"
              id="org-create-slug"
              name="organizationSlug"
              onChange={(e) => setSlug(e.currentTarget.value)}
              value={slug}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-create-ws">
            <span>{t("organizationsDefaultWorkspaceOptional")}</span>
            <Input
              autoComplete="organization"
              id="org-create-ws"
              name="defaultWorkspaceName"
              onChange={(e) => setWorkspaceName(e.currentTarget.value)}
              value={workspaceName}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-create-admin-email">
            <span>{t("organizationsInitialAdminEmailOptional")}</span>
            <Input
              autoComplete="email"
              id="org-create-admin-email"
              name="initialAdminEmail"
              onChange={(e) => setAdminEmail(e.currentTarget.value)}
              type="email"
              spellCheck={false}
              value={adminEmail}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-create-admin-name">
            <span>{t("organizationsInitialAdminNameOptional")}</span>
            <Input
              autoComplete="name"
              id="org-create-admin-name"
              name="initialAdminName"
              onChange={(e) => setAdminName(e.currentTarget.value)}
              value={adminName}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-create-admin-password">
            <span>{t("organizationsInitialAdminPasswordOptional")}</span>
            <Input
              autoComplete="new-password"
              id="org-create-admin-password"
              name="initialAdminPassword"
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
              .then(() => {
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
              autoComplete="organization"
              id="org-edit-name"
              name="organizationName"
              onChange={(e) => setName(e.currentTarget.value)}
              value={name}
            />
          </label>
          <label className="rm-form-field" htmlFor="org-edit-slug">
            <span>{t("organizationsSlug")}</span>
            <Input
              autoComplete="off"
              id="org-edit-slug"
              name="organizationSlug"
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
              .then(() => {
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
              autoComplete="off"
              id="org-suspend-reason"
              name="suspensionReasonCode"
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
