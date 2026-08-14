import { Input, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import Webhook from "lucide-react/dist/esm/icons/webhook.mjs";
import { useMemo, useState } from "react";

import {
  bulkDisableWebhooksMutationOptions,
  createWebhookMutationOptions,
  disableWebhookMutationOptions,
  testWebhookMutationOptions,
  webhookDeliveriesQueryOptions,
  webhooksQueryOptions,
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
import { AddButton, Section, StatRow } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { Drawer } from "./Drawer";
import { FormDialog } from "./FormDialog";
import { OverflowMenu } from "./OverflowMenu";
import { PageActions } from "./PageActions";
import { useWebhookDeliveryPager } from "./useWebhookDeliveryPager";
import { useWorkspace } from "./WorkspaceContext";

const webhookCol = createColumnHelper<WebhookSubscription>();
const deliveryCol = createColumnHelper<WebhookDelivery>();

export function WebhooksPanel() {
  const { locale, t } = useLocale();
  const { workspaceId } = useWorkspace();
  const { ask, dialog } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState<
    WebhookSubscription | undefined
  >(undefined);
  const selectedWebhookId = selectedWebhook?.id;
  const deliveryPager = useWebhookDeliveryPager();
  const deliveryCursor = deliveryPager.cursor;

  const webhooksQuery = useQuery(webhooksQueryOptions(workspaceId));
  const deliveriesQuery = useQuery(
    webhookDeliveriesQueryOptions({
      cursor: deliveryCursor,
      pageSize: deliveryPager.pageSize,
      webhookId: selectedWebhookId,
    }),
  );

  const createMutation = useMutation(createWebhookMutationOptions(workspaceId));
  const disableMutation = useMutation(
    disableWebhookMutationOptions(workspaceId),
  );
  const bulkDisableMutation = useMutation(
    bulkDisableWebhooksMutationOptions(workspaceId),
  );
  const testMutation = useMutation(testWebhookMutationOptions());

  function openDeliveries(webhook: WebhookSubscription) {
    setSelectedWebhook(webhook);
    deliveryPager.reset();
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
      toast(t("webhooksDisabled"), "success");
    } catch {
      toast(t("webhooksCouldNotDisable"), "error");
    }
  }

  async function handleTest(webhookId: string) {
    try {
      await testMutation.mutateAsync(webhookId);
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
          <span className="rm-mono font-medium" translate="no">
            {c.getValue()}
          </span>
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
    <Section
      actions={
        <div className="flex gap-2">
          <PageActions
            onRefresh={() => void webhooksQuery.refetch()}
            primary={
              (webhooksQuery.data?.length ?? 0) > 0 ? (
                <AddButton onClick={() => setAddOpen(true)}>
                  {t("webhooksAdd")}
                </AddButton>
              ) : undefined
            }
            refreshLabel={t("refresh")}
            refreshing={webhooksQuery.isFetching}
          />
        </div>
      }
    >
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
                        <span className="rm-mono" translate="no">
                          {eventType}
                        </span>
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

      <PanelState
        empty={t("webhooksNone")}
        emptyAction={
          <AddButton onClick={() => setAddOpen(true)}>
            {t("webhooksAdd")}
          </AddButton>
        }
        emptyDescription={t("webhooksNoneDescription")}
        emptyIcon={<Webhook aria-hidden size={24} />}
        query={webhooksQuery}
      >
        {(rows) => (
          <div className="grid gap-4">
            <StatRow
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
                  {t("webhooksDisable")} <LocalizedNumber value={ids.length} />
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

      <Drawer
        description={t("webhooksDeliveriesDescription")}
        onClose={() => setSelectedWebhook(undefined)}
        open={selectedWebhook !== undefined}
        title={selectedWebhook?.url ?? t("webhooksDeliveries")}
      >
        <PanelState
          empty={t("webhooksNoDeliveries")}
          emptyDescription={t("webhooksNoDeliveriesDescription")}
          emptyIcon={<Webhook aria-hidden size={24} />}
          isEmpty={(page) =>
            page.data.length === 0 && deliveryPager.isFirstPage
          }
          query={deliveriesQuery}
        >
          {(page) => (
            <DataTable
              columns={deliveryColumns}
              data={page.data}
              serverState={deliveryPager.tableState({
                isFetching: deliveriesQuery.isFetching,
                ...(page.nextCursor === undefined
                  ? {}
                  : { nextCursor: page.nextCursor }),
                ...(selectedWebhookId === undefined
                  ? {}
                  : { webhookId: selectedWebhookId }),
              })}
            />
          )}
        </PanelState>
      </Drawer>
      {dialog}
    </Section>
  );
}

function webhookDeliveryStatusMessageKey(
  status: WebhookDelivery["status"],
): MessageKey {
  if (status === "delivered") return "webhooksDeliveryDelivered";
  if (status === "failed") return "webhooksDeliveryFailed";
  return "webhooksDeliveryPending";
}
