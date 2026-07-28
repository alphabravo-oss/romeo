import { Button, Input, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
import { toast } from "../lib/toast";

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
  const grants = accessQuery.data ?? [];

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
        <label className="text-muted" htmlFor="workspace-file-retention">
          {t("govWorkspaceOverrides")}
        </label>
        <form.Field name="workspaceOverrides">
          {(field) => (
            <Textarea
              name="workspaceOverrides"
              className="font-mono text-xs"
              id="workspace-file-retention"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              placeholder={"workspace_id=90\nworkspace_indefinite=forever"}
              rows={3}
              value={field.state.value}
            />
          )}
        </form.Field>
        <label className="text-muted" htmlFor="user-file-retention">
          {t("govUserOverrides")}
        </label>
        <form.Field name="userOverrides">
          {(field) => (
            <Textarea
              name="userOverrides"
              className="font-mono text-xs"
              id="user-file-retention"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              placeholder={"user_id=30\nuser_indefinite=forever"}
              rows={3}
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
      <div className="grid gap-2 text-sm">
        {grants.slice(0, 6).map((grant) => (
          <div className="rounded-md border border-border p-2" key={grant.id}>
            <div className="font-medium">
              {grant.resourceType}:{grant.resourceId}
            </div>
            <div className="break-words text-muted">
              {grant.principalType}:{grant.principalId} - {grant.permission}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
