import { Button, IconButton, Input } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";

import {
  enforceRetention,
  getRetentionPolicy,
  listAccessReviewGrants,
  updateRetentionPolicy,
} from "../features";
import { type MessageKey, useLocale } from "../lib/i18n";
import {
  formatRetentionOverrides,
  parseOptionalRetentionDays,
  parseRetentionOverrides,
  RetentionValidationError,
  type RetentionValidationCode,
} from "../lib/retention";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";

type AccessGrant = Awaited<ReturnType<typeof listAccessReviewGrants>>[number];

const accessGrantColumn = createColumnHelper<AccessGrant>();

interface RetentionOverrideRow {
  days: string;
  id: string;
}

const retentionValidationMessageKeys: Record<
  RetentionValidationCode,
  MessageKey
> = {
  days_invalid: "govRetentionDaysInvalid",
  override_invalid_id: "govRetentionOverrideIdInvalid",
  override_duplicate: "govRetentionOverrideDuplicate",
  override_days_invalid: "govRetentionOverrideDaysInvalid",
  override_limit: "govRetentionOverrideLimit",
};

export function GovernanceRetentionTab() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const retentionQuery = useQuery({
    queryKey: ["retentionPolicy"],
    queryFn: getRetentionPolicy,
  });
  const accessQuery = useQuery({
    queryKey: ["accessReview"],
    queryFn: listAccessReviewGrants,
  });
  const updateMutation = useMutation({ mutationFn: updateRetentionPolicy });
  const enforceMutation = useMutation({
    mutationFn: enforceRetention,
    onSuccess: async (result) => {
      toast(
        `${t("govRetentionEnforced")} — ${result.deletedAuditLogCount} ${t("govAuditLogsAnd")} ${result.deletedFileObjectCount ?? 0} ${t("govExpiredFilesRemoved")}`,
        "success",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
        queryClient.invalidateQueries({ queryKey: ["dataExportPackages"] }),
      ]);
    },
    onError: () => toast(t("govCouldNotEnforceRetention"), "error"),
  });
  const accessGrantColumns: ColumnDef<AccessGrant, any>[] = [
    accessGrantColumn.accessor(
      (grant) => `${grant.resourceType}:${grant.resourceId}`,
      {
        id: "resource",
        header: t("govAccessResource"),
        cell: (cell) => (
          <span className="rm-mono break-all" translate="no">
            {cell.getValue()}
          </span>
        ),
      },
    ),
    accessGrantColumn.accessor(
      (grant) => `${grant.principalType}:${grant.principalId}`,
      {
        id: "principal",
        header: t("govAccessPrincipal"),
        cell: (cell) => (
          <span className="rm-mono break-all" translate="no">
            {cell.getValue()}
          </span>
        ),
      },
    ),
    accessGrantColumn.accessor("permission", {
      header: t("govAccessPermission"),
      cell: (cell) => <span className="rm-status pass">{cell.getValue()}</span>,
    }),
  ];

  const form = useForm({
    defaultValues: {
      days: retentionQuery.data?.auditLogRetentionDays ?? 365,
      fileDays: retentionQuery.data?.fileRetentionDays?.toString() ?? "",
      workspaceOverrides: formatRetentionOverrides(
        retentionQuery.data?.workspaceFileRetentionDays ?? {},
      ),
      userOverrides: formatRetentionOverrides(
        retentionQuery.data?.userFileRetentionDays ?? {},
      ),
    },
    onSubmit: async ({ value }) => {
      try {
        await updateMutation.mutateAsync({
          auditLogRetentionDays: value.days,
          fileRetentionDays: parseOptionalRetentionDays(value.fileDays),
          workspaceFileRetentionDays: parseRetentionOverrides(
            value.workspaceOverrides,
          ),
          userFileRetentionDays: parseRetentionOverrides(value.userOverrides),
        });
        toast(t("govRetentionPolicySaved"), "success");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["retentionPolicy"] }),
          queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
        ]);
      } catch (error) {
        toast(
          error instanceof RetentionValidationError
            ? t(retentionValidationMessageKeys[error.code])
            : error instanceof Error
              ? error.message
              : t("govCouldNotSaveRetentionPolicy"),
          "error",
        );
      }
    },
  });
  return (
    <div className="grid gap-4">
      <form
        className="grid gap-2 text-sm"
        key={retentionQuery.data?.updatedAt ?? "default"}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <label className="text-muted" htmlFor="audit-retention-days">
          {t("govAuditRetentionDays")}
        </label>
        <form.Field name="days">
          {(field) => (
            <Input
              name="days"
              id="audit-retention-days"
              max={3650}
              min={30}
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(Number(event.currentTarget.value))
              }
              type="number"
              value={field.state.value}
            />
          )}
        </form.Field>
        <label className="text-muted" htmlFor="file-retention-days">
          {t("govDefaultFileRetentionDays")}
        </label>
        <form.Field name="fileDays">
          {(field) => (
            <Input
              name="fileDays"
              id="file-retention-days"
              max={3650}
              min={1}
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              placeholder={t("govBlankKeepsFilesIndefinitely")}
              type="number"
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="workspaceOverrides">
          {(field) => (
            <RetentionOverrideEditor
              idPrefix="workspace-file-retention"
              label={t("govWorkspaceOverrides")}
              onChange={field.handleChange}
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="userOverrides">
          {(field) => (
            <RetentionOverrideEditor
              idPrefix="user-file-retention"
              label={t("govUserOverrides")}
              onChange={field.handleChange}
              value={field.state.value}
            />
          )}
        </form.Field>
        <p className="text-muted">{t("govRetentionOverrideGuidance")}</p>
        <div className="flex flex-wrap gap-2">
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                disabled={
                  updateMutation.isPending || !canSubmit || isSubmitting
                }
                type="submit"
              >
                {updateMutation.isPending
                  ? t("govSaving")
                  : t("govSaveRetention")}
              </Button>
            )}
          </form.Subscribe>
          <Button
            disabled={enforceMutation.isPending}
            onClick={() => {
              if (!window.confirm(t("govRetentionConfirm"))) return;
              enforceMutation.mutate();
            }}
            type="button"
          >
            {enforceMutation.isPending
              ? t("govEnforcing")
              : t("govRunRetentionNow")}
          </Button>
        </div>
      </form>
      <PanelState query={accessQuery} empty={t("noAccessGrants")}>
        {(grants) => (
          <div className="grid gap-2 text-sm">
            <DataTable
              columns={accessGrantColumns}
              data={grants}
              empty={t("noAccessGrants")}
              getRowId={(grant) => grant.id}
              maxBodyHeight={320}
              minTableWidth={720}
            />
          </div>
        )}
      </PanelState>
    </div>
  );
}

function parseEditorRows(value: string): RetentionOverrideRow[] {
  return value
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const separator = line.indexOf("=");
      return {
        id: separator < 0 ? line.trim() : line.slice(0, separator).trim(),
        days: separator < 0 ? "90" : line.slice(separator + 1).trim() || "90",
      };
    });
}

function serializeEditorRows(rows: RetentionOverrideRow[]): string {
  return rows.map((row) => `${row.id}=${row.days}`).join("\n");
}

function RetentionOverrideEditor({
  idPrefix,
  label,
  onChange,
  value,
}: {
  idPrefix: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const { t } = useLocale();
  const rows = parseEditorRows(value);
  const updateRow = (index: number, patch: Partial<RetentionOverrideRow>) => {
    const next = rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, ...patch } : row,
    );
    onChange(serializeEditorRows(next));
  };
  return (
    <fieldset className="grid gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="text-sm font-medium">{label}</legend>
        <Button
          onClick={() =>
            onChange(serializeEditorRows([...rows, { days: "90", id: "" }]))
          }
          size="sm"
          type="button"
        >
          + {t("govAddOverride")}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("govNoOverrides")}</p>
      ) : (
        <div className="grid gap-2">
          {rows.map((row, index) => (
            <div
              className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
              key={`${idPrefix}-${index}`}
            >
              <label className="grid gap-1 text-xs text-muted">
                {t("govOverrideId")}
                <Input
                  id={`${idPrefix}-${index}-id`}
                  name={`${idPrefix}-${index}-id`}
                  onChange={(event) =>
                    updateRow(index, { id: event.currentTarget.value })
                  }
                  placeholder={t("govOverrideIdPlaceholder")}
                  value={row.id}
                />
              </label>
              <div className="grid gap-1">
                <span className="text-xs text-muted">
                  {t("govRetentionPeriod")}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={t("govRetentionDays")}
                    disabled={row.days === "forever"}
                    max={3650}
                    min={1}
                    name={`${idPrefix}-${index}-days`}
                    onChange={(event) =>
                      updateRow(index, { days: event.currentTarget.value })
                    }
                    type="number"
                    value={row.days === "forever" ? "" : row.days}
                  />
                  <Button
                    aria-pressed={row.days === "forever"}
                    onClick={() =>
                      updateRow(index, {
                        days: row.days === "forever" ? "90" : "forever",
                      })
                    }
                    size="sm"
                    type="button"
                    variant={row.days === "forever" ? "primary" : "default"}
                  >
                    {t("govForever")}
                  </Button>
                </div>
              </div>
              <IconButton
                aria-label={`${t("govRemoveOverride")}: ${row.id || index + 1}`}
                onClick={() =>
                  onChange(
                    serializeEditorRows(
                      rows.filter((_, rowIndex) => rowIndex !== index),
                    ),
                  )
                }
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden size={16} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}
