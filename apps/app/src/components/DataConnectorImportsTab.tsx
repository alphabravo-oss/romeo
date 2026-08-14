import { Button, Input, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  dataConnectorSyncsQueryOptions,
  syncLocalDataConnectorMutationOptions,
} from "../features";
import type { DataConnector } from "../features/types";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { mimeTypeFor } from "./DataConnectorCatalog";
import { DataConnectorSyncHistory } from "./DataConnectorSyncHistory";

export function DataConnectorImportsTab({
  connector,
}: {
  connector: DataConnector | undefined;
}) {
  const { t } = useLocale();
  const syncsQuery = useQuery(dataConnectorSyncsQueryOptions(connector?.id));
  const syncMutation = useMutation(syncLocalDataConnectorMutationOptions());
  const syncForm = useForm({
    defaultValues: {
      fileName: "",
      content: "",
    },
    onSubmit: async ({ value }) => {
      if (!connector) return;
      try {
        await syncMutation.mutateAsync({
          connectorId: connector.id,
          fileName: value.fileName,
          mimeType: mimeTypeFor(value.fileName),
          content: value.content,
        });
        toast(t("connectorSynced"), "success");
      } catch (caught) {
        toast(t("connectorSyncFailed"), "error");
        throw caught;
      } finally {
        syncMutation.reset();
      }
    },
  });

  return (
    <div className="grid gap-4">
      <div>
        <div className="rm-card-title">{t("connectorImportsTitle")}</div>
        <p className="text-sm text-muted">
          {connector
            ? `${t("connectorImportingTo")} ${connector.name}`
            : t("connectorImportNeedsSource")}
        </p>
      </div>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void syncForm.handleSubmit();
        }}
      >
        <label className="text-sm text-muted" htmlFor="connector-file-name">
          {t("connectorSourceFile")}
        </label>
        <syncForm.Field
          name="fileName"
          validators={{
            onChange: ({ value }: { value: string }) =>
              !value?.trim() ? t("connectorSourceFileRequired") : undefined,
          }}
        >
          {(field) => (
            <>
              <Input
                name="fileName"
                id="connector-file-name"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("connectorSourceFilePlaceholder")}
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">
                  {field.state.meta.errors.join(", ")}
                </div>
              ) : null}
            </>
          )}
        </syncForm.Field>
        <label
          className="text-sm text-muted"
          htmlFor="connector-source-content"
        >
          {t("connectorSourceText")}
        </label>
        <syncForm.Field
          name="content"
          validators={{
            onChange: ({ value }: { value: string }) =>
              !value?.trim() ? t("connectorSourceTextRequired") : undefined,
          }}
        >
          {(field) => (
            <>
              <Textarea
                name="content"
                className="min-h-24"
                id="connector-source-content"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("connectorSourceTextPlaceholder")}
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">
                  {field.state.meta.errors.join(", ")}
                </div>
              ) : null}
            </>
          )}
        </syncForm.Field>
        <syncForm.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button
              disabled={!canSubmit || isSubmitting || !connector}
              type="submit"
            >
              {isSubmitting
                ? t("connectorSyncing")
                : t("connectorSyncLocalText")}
            </Button>
          )}
        </syncForm.Subscribe>
      </form>
      <DataConnectorSyncHistory syncs={syncsQuery.data ?? []} />
    </div>
  );
}
