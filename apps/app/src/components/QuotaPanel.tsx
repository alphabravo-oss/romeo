import { Button, Field, Input, NativeSelect } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { createQuotaBucket, deleteQuotaBucket, listQuotas } from "../features";
import type { QuotaBucket } from "../features/types";
import { PanelState } from "../lib/panel-state";
import { useLocale, type MessageKey } from "../lib/i18n";
import { toast } from "../lib/toast";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";
import { QuotaEditDialog } from "./QuotaEditDialog";
import { LocalizedDate } from "../lib/locale-format";
import { useWorkspace } from "./WorkspaceContext";

const quotaCol = createColumnHelper<QuotaBucket>();

const quotaMetrics: QuotaBucket["metric"][] = [
  "image.generated",
  "image.cost.micro_usd",
  "web.search.request",
  "web.url.fetch",
  "run.started",
  "tool.call",
  "storage.byte",
];
const quotaScopeTypes: QuotaBucket["scopeType"][] = [
  "org",
  "user",
  "workspace",
  "provider",
  "agent",
  "api_key",
];

export function QuotaPanel() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  const { ask, dialog } = useConfirm();
  const quotasQuery = useQuery({ queryKey: ["quotas"], queryFn: listQuotas });
  const createMutation = useMutation({ mutationFn: createQuotaBucket });
  const deleteMutation = useMutation({ mutationFn: deleteQuotaBucket });
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<QuotaBucket | null>(null);

  const quotaForm = useForm({
    defaultValues: {
      scopeType: "org" as QuotaBucket["scopeType"],
      scopeId: "",
      metric: "tool.call" as QuotaBucket["metric"],
      limit: 25,
      resetInterval: "none" as QuotaBucket["resetInterval"],
    },
    onSubmit: async ({ value }) => {
      try {
        const input: Parameters<typeof createQuotaBucket>[0] = {
          scopeType: value.scopeType,
          metric: value.metric,
          limit: value.limit,
          resetInterval: value.resetInterval,
        };
        if (requiresScopeId(value.scopeType)) {
          input.scopeId =
            value.scopeType === "workspace"
              ? (workspaceId ?? value.scopeId)
              : value.scopeId;
        }
        await createMutation.mutateAsync(input);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["quotas"] }),
          queryClient.invalidateQueries({ queryKey: ["usageAlerts"] }),
        ]);
        toast(t("quotaSaved"), "success");
        setAddOpen(false);
      } catch (caught) {
        toast(t("couldNotSaveQuota"), "error");
        throw caught;
      }
    },
  });

  const columns = useMemo<ColumnDef<QuotaBucket, any>[]>(
    () => [
      quotaCol.accessor("metric", {
        header: t("metric"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      quotaCol.accessor((row) => `${row.scopeType}:${row.scopeId}`, {
        id: "scope",
        header: t("quotaScope"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      quotaCol.accessor((row) => `${row.used}/${row.limit}`, {
        id: "usage",
        header: t("quotaUsedLimit"),
        cell: (c) => <span>{c.getValue()}</span>,
      }),
      quotaCol.accessor("resetInterval", {
        header: t("reset"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {c.getValue()}
            {c.row.original.resetAt ? (
              <>
                {" "}
                - {t("quotaResets")}{" "}
                <LocalizedDate value={c.row.original.resetAt} />
              </>
            ) : (
              ""
            )}
          </span>
        ),
      }),
      quotaCol.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <div className="flex items-center gap-2">
            <Button onClick={() => setEditing(c.row.original)} type="button">
              {t("quotaEdit")}
            </Button>
            <Button
              disabled={deleteMutation.isPending}
              onClick={() => void handleDelete(c.row.original.id)}
              type="button"
            >
              {t("quotaDelete")}
            </Button>
          </div>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteMutation.isPending, t],
  );

  async function handleDelete(quotaBucketId: string) {
    if (
      !(await ask({
        title: t("deleteQuotaTitle"),
        confirmLabel: t("quotaDelete"),
        tone: "danger",
      }))
    )
      return;
    try {
      await deleteMutation.mutateAsync(quotaBucketId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["quotas"] }),
        queryClient.invalidateQueries({ queryKey: ["usageAlerts"] }),
      ]);
      toast(t("quotaRemoved"), "success");
    } catch {
      toast(t("couldNotRemoveQuota"), "error");
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">{t("quotaBuckets")}</div>
        <div className="flex items-center gap-2">
          <Button
            disabled={quotasQuery.isFetching}
            onClick={() => void quotasQuery.refetch()}
            type="button"
          >
            {quotasQuery.isFetching ? t("refreshing") : t("refresh")}
          </Button>
          <Button
            variant="primary"
            onClick={() => setAddOpen(true)}
            type="button"
          >
            + {t("addQuota")}
          </Button>
        </div>
      </div>
      <FormDialog
        open={addOpen}
        title={t("newQuota")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void quotaForm.handleSubmit();
          }}
        >
          <quotaForm.Field name="scopeType">
            {(field) => (
              <Field label={t("quotaScope")}>
                <NativeSelect
                  name="scopeType"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(
                      event.currentTarget.value as QuotaBucket["scopeType"],
                    )
                  }
                  value={field.state.value}
                >
                  {quotaScopeTypes.map((option) => (
                    <option key={option} value={option}>
                      {t(quotaScopeKey(option))}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </quotaForm.Field>
          <quotaForm.Subscribe selector={(state) => state.values.scopeType}>
            {(scopeType) =>
              requiresScopeId(scopeType) ? (
                <quotaForm.Field
                  name="scopeId"
                  validators={{
                    onChange: ({ value }: { value: string }) =>
                      !value?.trim() ? t("quotaScopeIdRequired") : undefined,
                  }}
                >
                  {(field) => (
                    <>
                      <Input
                        name="scopeId"
                        aria-label={`${scopeType} id`}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.currentTarget.value)
                        }
                        placeholder={`${scopeType} id`}
                        value={field.state.value}
                      />
                      {field.state.meta.errors.length ? (
                        <div className="rm-composer-error">
                          {field.state.meta.errors.join(", ")}
                        </div>
                      ) : null}
                    </>
                  )}
                </quotaForm.Field>
              ) : null
            }
          </quotaForm.Subscribe>
          <quotaForm.Field name="metric">
            {(field) => (
              <Field label={t("metric")}>
                <NativeSelect
                  name="metric"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(
                      event.currentTarget.value as QuotaBucket["metric"],
                    )
                  }
                  value={field.state.value}
                >
                  {quotaMetrics.map((option) => (
                    <option key={option} value={option}>
                      {t(quotaMetricKey(option))}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </quotaForm.Field>
          <quotaForm.Field name="limit">
            {(field) => (
              <Field label={t("limit")}>
                <Input
                  name="limit"
                  min={0}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(Number(event.currentTarget.value))
                  }
                  type="number"
                  value={field.state.value}
                />
              </Field>
            )}
          </quotaForm.Field>
          <quotaForm.Field name="resetInterval">
            {(field) => (
              <Field label={t("reset")}>
                <NativeSelect
                  name="resetInterval"
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
              </Field>
            )}
          </quotaForm.Field>
          <quotaForm.Subscribe
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
          </quotaForm.Subscribe>
        </form>
      </FormDialog>
      {editing !== null ? (
        <QuotaEditDialog
          key={editing.id}
          quota={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ["quotas"] });
            setEditing(null);
          }}
        />
      ) : null}
      <div className="mt-4">
        <PanelState
          query={quotasQuery}
          empty={t("noQuotasYet")}
          emptyAction={
            <Button
              variant="primary"
              onClick={() => setAddOpen(true)}
              type="button"
            >
              + {t("addQuota")}
            </Button>
          }
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: t("totalQuotaBuckets"), value: rows.length },
                  {
                    label: t("quotaWithReset"),
                    value: rows.filter((row) => row.resetInterval !== "none")
                      .length,
                  },
                ]}
              />
              <DataTable columns={columns} data={rows} />
            </div>
          )}
        </PanelState>
      </div>
      {dialog}
    </section>
  );
}

function requiresScopeId(scopeType: QuotaBucket["scopeType"]): boolean {
  return scopeType !== "org" && scopeType !== "user";
}

function quotaScopeKey(scope: QuotaBucket["scopeType"]): MessageKey {
  switch (scope) {
    case "agent":
      return "quotaScopeAssistant";
    case "api_key":
      return "quotaScopeApiKey";
    case "org":
      return "quotaScopeOrganization";
    case "provider":
      return "quotaScopeProvider";
    case "user":
      return "quotaScopeUser";
    case "workspace":
      return "quotaScopeWorkspace";
  }
}

function quotaMetricKey(metric: QuotaBucket["metric"]): MessageKey {
  switch (metric) {
    case "image.cost.micro_usd":
      return "quotaMetricImageCost";
    case "image.generated":
      return "quotaMetricImagesGenerated";
    case "run.started":
      return "quotaMetricRunsStarted";
    case "storage.byte":
      return "quotaMetricStorageBytes";
    case "tool.call":
      return "quotaMetricToolCalls";
    case "web.search.request":
      return "quotaMetricWebSearches";
    case "web.url.fetch":
      return "quotaMetricWebFetches";
  }
}
