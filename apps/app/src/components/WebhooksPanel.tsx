import { Input, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  bulkDisableWebhooks,
  createWebhook,
  disableWebhook,
  listWebhookDeliveriesPage,
  listWebhooks,
  testWebhook,
} from "../features/webhooks";
import {
  type WebhookDelivery,
  type WebhookEventType,
  type WebhookSubscription,
  webhookEventTypes,
} from "../features/webhooks";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import {
  formatNumber,
  LocalizedDateTime,
  LocalizedNumber,
} from "../lib/locale-format";
import { toast } from "../lib/toast";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { Drawer } from "./Drawer";
import { FormDialog } from "./FormDialog";
import { OverflowMenu } from "./OverflowMenu";
import { PanelStats } from "./PanelStats";
import { useWorkspace } from "./WorkspaceContext";

const DELIVERIES_PAGE_SIZE = 25;

const webhookCol = createColumnHelper<WebhookSubscription>();
const deliveryCol = createColumnHelper<WebhookDelivery>();

export function WebhooksPanel() {
  const queryClient = useQueryClient();
  const { locale, t } = useLocale();
  const { workspaceId } = useWorkspace();
  const { ask, dialog } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState<
    WebhookSubscription | undefined
  >(undefined);
  const selectedWebhookId = selectedWebhook?.id;
  // Cursor stack for the deliveries pager: index 0 is the first page (undefined
  // cursor); each push is the nextCursor that opened the following page.
  const [deliveryCursors, setDeliveryCursors] = useState<
    Array<string | undefined>
  >([undefined]);
  const deliveryCursor = deliveryCursors[deliveryCursors.length - 1];

  const webhooksQuery = useQuery({
    queryKey: ["webhooks", workspaceId],
    queryFn: () => listWebhooks(workspaceId),
  });
  const deliveriesQuery = useQuery({
    queryKey: ["webhookDeliveries", selectedWebhookId, deliveryCursor],
    queryFn: () =>
      listWebhookDeliveriesPage({
        webhookId: selectedWebhookId!,
        limit: DELIVERIES_PAGE_SIZE,
        ...(deliveryCursor !== undefined ? { cursor: deliveryCursor } : {}),
      }),
    enabled: selectedWebhookId !== undefined,
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({ mutationFn: createWebhook });
  const disableMutation = useMutation({ mutationFn: disableWebhook });
  const bulkDisableMutation = useMutation({ mutationFn: bulkDisableWebhooks });
  const testMutation = useMutation({ mutationFn: testWebhook });

  function openDeliveries(webhook: WebhookSubscription) {
    setSelectedWebhook(webhook);
    setDeliveryCursors([undefined]);
  }

  const createForm = useForm({
    defaultValues: {
      url: "",
      eventTypes: ["webhook.test"] as WebhookEventType[],
    },
    onSubmit: async ({ value }) => {
      try {
        await createMutation.mutateAsync({
          url: value.url,
          eventTypes: value.eventTypes,
        });
        await queryClient.invalidateQueries({
          queryKey: ["webhooks", workspaceId],
        });
        toast(t("webhooksCreated"), "success");
        createForm.reset();
        setAddOpen(false);
      } catch (caught) {
        toast(t("webhooksCouldNotCreate"), "error");
        throw caught;
      }
    },
  });

  async function handleDisable(webhookId: string) {
    if (
      !(await ask({
        title: t("webhooksDisableTitle"),
        confirmLabel: t("webhooksDisable"),
        tone: "danger",
      }))
    )
      return;
    try {
      await disableMutation.mutateAsync(webhookId);
      await queryClient.invalidateQueries({
        queryKey: ["webhooks", workspaceId],
      });
      toast(t("webhooksDisabled"), "success");
    } catch {
      toast(t("webhooksCouldNotDisable"), "error");
    }
  }

  async function handleTest(webhookId: string) {
    try {
      await testMutation.mutateAsync(webhookId);
      await queryClient.invalidateQueries({
        queryKey: ["webhookDeliveries", webhookId],
      });
      toast(t("webhooksTestSent"), "success");
    } catch {
      toast(t("webhooksCouldNotTest"), "error");
    }
  }

  async function handleBulkDisable(
    webhookIds: string[],
    clearSelection: () => void,
  ) {
    if (
      !(await ask({
        title: `${t("webhooksDisableSelected")} (${formatNumber(webhookIds.length, locale)})`,
        confirmLabel: t("webhooksDisable"),
        tone: "danger",
      }))
    )
      return;
    try {
      const results = await bulkDisableMutation.mutateAsync(webhookIds);
      await queryClient.invalidateQueries({
        queryKey: ["webhooks", workspaceId],
      });
      clearSelection();
      const disabled = results.filter(
        (result) => result.status === "disabled",
      ).length;
      toast(
        `${t("webhooksDisabledCount")}: ${formatNumber(disabled, locale)}`,
        "success",
      );
    } catch {
      toast(t("webhooksCouldNotDisableMany"), "error");
    }
  }

  const webhookColumns = useMemo<ColumnDef<WebhookSubscription, any>[]>(
    () => [
      webhookCol.accessor("url", {
        header: t("webhooksUrl"),
        cell: (c) => (
          <span className="rm-mono font-medium">{c.getValue()}</span>
        ),
      }),
      webhookCol.accessor((row) => row.eventTypes.join(", "), {
        id: "eventTypes",
        header: t("webhooksEvents"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      }),
      webhookCol.accessor((row) => row.disabledAt !== undefined, {
        id: "status",
        header: t("webhooksStatus"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {c.getValue()
              ? t("webhooksStatusDisabled")
              : t("webhooksStatusActive")}
          </span>
        ),
      }),
      webhookCol.display({
        id: "actions",
        header: "",
        cell: (c) => {
          const webhook = c.row.original;
          return (
            <div className="flex justify-end">
              <OverflowMenu
                items={[
                  {
                    label: t("webhooksTest"),
                    onClick: () => void handleTest(webhook.id),
                    disabled: testMutation.isPending,
                  },
                  {
                    label: t("webhooksViewDeliveries"),
                    onClick: () => openDeliveries(webhook),
                  },
                  ...(webhook.disabledAt
                    ? []
                    : [
                        {
                          label: t("webhooksDisable"),
                          onClick: () => void handleDisable(webhook.id),
                          tone: "danger" as const,
                          disabled: disableMutation.isPending,
                        },
                      ]),
                ]}
              />
            </div>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disableMutation.isPending, testMutation.isPending, t],
  );

  const deliveryColumns = useMemo<ColumnDef<WebhookDelivery, any>[]>(
    () => [
      deliveryCol.accessor("eventType", {
        header: t("webhooksEvent"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      deliveryCol.accessor("status", {
        header: t("webhooksStatus"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {t(webhookDeliveryStatusMessageKey(c.getValue()))}
          </span>
        ),
      }),
      deliveryCol.accessor("attemptCount", {
        header: t("webhooksAttempts"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedNumber value={c.getValue()} />
          </span>
        ),
      }),
      deliveryCol.accessor((row) => row.createdAt, {
        id: "createdAt",
        header: t("webhooksCreatedAt"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={c.getValue()} />
          </span>
        ),
      }),
    ],
    [t],
  );

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("webhooksTitle")}</div>
        <div className="flex gap-2">
          <Button
            disabled={webhooksQuery.isFetching}
            onClick={() => void webhooksQuery.refetch()}
            type="button"
          >
            {webhooksQuery.isFetching ? t("refreshing") : t("refresh")}
          </Button>
          <Button
            variant="primary"
            onClick={() => setAddOpen(true)}
            type="button"
          >
            + {t("webhooksAdd")}
          </Button>
        </div>
      </div>

      <FormDialog
        open={addOpen}
        title={t("webhooksNew")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void createForm.handleSubmit();
          }}
        >
          <createForm.Field
            name="url"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("webhooksUrlRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Input
                  name="url"
                  aria-label={t("webhooksUrl")}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder="https://example.com/webhook"
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </createForm.Field>
          <createForm.Field
            name="eventTypes"
            validators={{
              onChange: ({ value }: { value: WebhookEventType[] }) =>
                value.length === 0 ? t("webhooksSelectEvent") : undefined,
            }}
          >
            {(field) => (
              <>
                <div className="grid gap-1">
                  {webhookEventTypes.map((eventType) => {
                    const checked = field.state.value.includes(eventType);
                    return (
                      <label
                        className="flex items-center gap-2 text-sm"
                        key={eventType}
                      >
                        <Input
                          name="eventTypes"
                          checked={checked}
                          onChange={(event) => {
                            const next = event.currentTarget.checked
                              ? [...field.state.value, eventType]
                              : field.state.value.filter(
                                  (value) => value !== eventType,
                                );
                            field.handleChange(next);
                          }}
                          type="checkbox"
                        />
                        <span className="rm-mono">{eventType}</span>
                      </label>
                    );
                  })}
                </div>
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </createForm.Field>
          <createForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button disabled={!canSubmit || isSubmitting} type="submit">
                {isSubmitting ? t("webhooksCreating") : t("webhooksCreate")}
              </Button>
            )}
          </createForm.Subscribe>
        </form>
      </FormDialog>

      <div className="mt-4">
        <PanelState
          empty={t("webhooksNone")}
          emptyAction={
            <Button
              variant="primary"
              onClick={() => setAddOpen(true)}
              type="button"
            >
              + {t("webhooksAdd")}
            </Button>
          }
          query={webhooksQuery}
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: t("webhooksTotal"), value: rows.length },
                  {
                    label: t("webhooksDisabledStat"),
                    value: rows.filter((row) => row.disabledAt).length,
                  },
                ]}
              />
              <DataTable
                bulkActions={(ids, clear) => (
                  <Button
                    disabled={bulkDisableMutation.isPending}
                    onClick={() => void handleBulkDisable(ids, clear)}
                    type="button"
                  >
                    {t("webhooksDisable")}{" "}
                    <LocalizedNumber value={ids.length} />
                  </Button>
                )}
                columns={webhookColumns}
                data={rows}
                enableRowSelection
                getRowId={(row) => row.id}
              />
            </div>
          )}
        </PanelState>
      </div>

      <Drawer
        description={t("webhooksDeliveriesDescription")}
        onClose={() => setSelectedWebhook(undefined)}
        open={selectedWebhook !== undefined}
        title={selectedWebhook?.url ?? t("webhooksDeliveries")}
      >
        <PanelState
          empty={t("webhooksNoDeliveries")}
          isEmpty={(page) =>
            page.data.length === 0 && deliveryCursors.length === 1
          }
          query={deliveriesQuery}
        >
          {(page) => (
            <DataTable
              columns={deliveryColumns}
              data={page.data}
              serverPagination={{
                pageSize: DELIVERIES_PAGE_SIZE,
                hasNextPage: page.nextCursor !== undefined,
                isFetching: deliveriesQuery.isFetching,
                onNextPage: () => {
                  if (page.nextCursor !== undefined)
                    setDeliveryCursors((stack) => [...stack, page.nextCursor]);
                },
                ...(deliveryCursors.length > 1
                  ? {
                      onPrevPage: () =>
                        setDeliveryCursors((stack) => stack.slice(0, -1)),
                    }
                  : {}),
              }}
            />
          )}
        </PanelState>
      </Drawer>
      {dialog}
    </section>
  );
}

function webhookDeliveryStatusMessageKey(
  status: WebhookDelivery["status"],
): MessageKey {
  if (status === "delivered") return "webhooksDeliveryDelivered";
  if (status === "failed") return "webhooksDeliveryFailed";
  return "webhooksDeliveryPending";
}
