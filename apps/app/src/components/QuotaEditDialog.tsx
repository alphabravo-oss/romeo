import { Button, Input, NativeSelect } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";

import { updateQuotaBucket } from "../features";
import type { QuotaBucket } from "../features/types";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { FormDialog } from "./FormDialog";

export function QuotaEditDialog({
  quota,
  onClose,
  onSaved,
}: {
  quota: QuotaBucket;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const editForm = useForm({
    defaultValues: {
      limit: quota.limit,
      resetInterval: quota.resetInterval,
    },
    onSubmit: async ({ value }) => {
      try {
        await updateQuotaBucket(quota.id, {
          limit: value.limit,
          resetInterval: value.resetInterval,
        });
        toast(t("quotaUpdated"), "success");
        await onSaved();
      } catch (caught) {
        toast(t("couldNotUpdateQuota"), "error");
        throw caught;
      }
    },
  });

  return (
    <FormDialog
      open
      title={t("editQuota")}
      description={`${quota.scopeType}:${quota.scopeId}`}
      onClose={onClose}
    >
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void editForm.handleSubmit();
        }}
      >
        <label className="text-sm text-muted" htmlFor="quota-edit-limit">
          {t("limit")}
        </label>
        <editForm.Field name="limit">
          {(field) => (
            <Input
              name="limit"
              id="quota-edit-limit"
              min={0}
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(Number(event.currentTarget.value))
              }
              type="number"
              value={field.state.value}
            />
          )}
        </editForm.Field>
        <label className="text-sm text-muted" htmlFor="quota-edit-reset">
          {t("reset")}
        </label>
        <editForm.Field name="resetInterval">
          {(field) => (
            <NativeSelect
              name="resetInterval"
              id="quota-edit-reset"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(
                  event.currentTarget.value as QuotaBucket["resetInterval"],
                )
              }
              value={field.state.value}
            >
              <option value="none">{t("noReset")}</option>
              <option value="daily">{t("daily")}</option>
              <option value="monthly">{t("monthly")}</option>
            </NativeSelect>
          )}
        </editForm.Field>
        <editForm.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? t("saving") : t("saveQuota")}
            </Button>
          )}
        </editForm.Subscribe>
      </form>
    </FormDialog>
  );
}
