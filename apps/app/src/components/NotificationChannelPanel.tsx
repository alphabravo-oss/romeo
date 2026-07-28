import { Input, NativeSelect, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  createNotificationChannel,
  listNotificationChannels,
  listNotificationDeliveries,
  notificationChannelTypes,
} from "../features/notifications";
import type {
  CreateNotificationChannelInput,
  NotificationDelivery,
  NotificationDeliveryChannel,
  NotificationDeliveryChannelType,
} from "../features/notifications";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";
import { NotificationPolicyForm } from "./NotificationPolicyForm";
import { Tabs } from "./Tabs";

const channelCol = createColumnHelper<NotificationDeliveryChannel>();
const deliveryCol = createColumnHelper<NotificationDelivery>();

function notificationChannelInput(value: {
  type: NotificationDeliveryChannelType;
  name: string;
  target: string;
  platform: "android" | "ios" | "web";
  collapseKey: string;
  severity: "critical" | "error" | "info" | "warning";
}): CreateNotificationChannelInput {
  switch (value.type) {
    case "email":
      return { type: "email", name: value.name, config: { to: value.target } };
    case "mobile_push":
      return {
        type: "mobile_push",
        name: value.name,
        config: {
          tokenRef: value.target,
          platform: value.platform,
          ...(value.collapseKey.trim() === ""
            ? {}
            : { collapseKey: value.collapseKey.trim() }),
        },
      };
    case "pagerduty":
      return {
        type: "pagerduty",
        name: value.name,
        config: { routingKeyRef: value.target, severity: value.severity },
      };
    case "slack":
    case "teams":
    case "webhook":
      return {
        type: value.type,
        name: value.name,
        config: { url: value.target },
      };
  }
}

export function NotificationChannelPanel() {
  const { t } = useLocale();
  return (
    <section className="rm-panel p-4">
      <Tabs
        tabs={[
          { id: "channels", label: t("channels"), content: <ChannelsTab /> },
          {
            id: "policy",
            label: t("notificationPolicy"),
            content: <NotificationPolicyForm />,
          },
        ]}
      />
    </section>
  );
}

function ChannelsTab() {
  const { t } = useLocale();
  const required = ({ value }: { value: string }) =>
    !value?.trim() ? t("required") : undefined;
  const queryClient = useQueryClient();
  const channelsQuery = useQuery({
    queryKey: ["notificationChannels"],
    queryFn: listNotificationChannels,
  });
  const deliveriesQuery = useQuery({
    queryKey: ["notificationDeliveries"],
    queryFn: listNotificationDeliveries,
  });
  const createMutation = useMutation({ mutationFn: createNotificationChannel });
  const [addOpen, setAddOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      type: "email" as NotificationDeliveryChannelType,
      name: "",
      target: "",
      platform: "ios" as "android" | "ios" | "web",
      collapseKey: "",
      severity: "warning" as "critical" | "error" | "info" | "warning",
    },
    onSubmit: async ({ value }) => {
      try {
        const input = notificationChannelInput(value);
        await createMutation.mutateAsync(input);
        await queryClient.invalidateQueries({
          queryKey: ["notificationChannels"],
        });
        toast(t("channelCreated"), "success");
        setAddOpen(false);
      } catch (caught) {
        toast(t("couldNotCreateChannel"), "error");
        throw caught;
      }
    },
  });

  const channelColumns = useMemo<ColumnDef<NotificationDeliveryChannel, any>[]>(
    () => [
      channelCol.accessor("name", {
        header: t("name"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      channelCol.accessor("type", {
        header: t("type"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      }),
      channelCol.accessor((row) => (row.enabled ? "enabled" : "disabled"), {
        id: "enabled",
        header: t("state"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {c.getValue() === "enabled" ? t("enabled") : t("disabled")}
          </span>
        ),
      }),
      channelCol.accessor("createdAt", {
        header: t("created"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={c.getValue()} />
          </span>
        ),
      }),
    ],
    [t],
  );

  const deliveryColumns = useMemo<ColumnDef<NotificationDelivery, any>[]>(
    () => [
      deliveryCol.accessor("notificationId", {
        header: t("notification"),
        cell: (c) => (
          <span className="rm-mono rm-cell-muted">{c.getValue()}</span>
        ),
      }),
      deliveryCol.accessor("channelId", {
        header: t("channel"),
        cell: (c) => (
          <span className="rm-mono rm-cell-muted">{c.getValue()}</span>
        ),
      }),
      deliveryCol.accessor("status", {
        header: t("status"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      deliveryCol.accessor("attemptCount", {
        header: t("attempts"),
        cell: (c) => <span>{c.getValue()}</span>,
      }),
      deliveryCol.accessor((row) => row.errorCode ?? "", {
        id: "error",
        header: t("error"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      }),
    ],
    [t],
  );

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("notificationChannels")}</div>
        <div className="flex items-center gap-2">
          <Button
            disabled={channelsQuery.isFetching}
            onClick={() => void channelsQuery.refetch()}
            type="button"
          >
            {channelsQuery.isFetching ? t("refreshing") : t("refresh")}
          </Button>
          <Button
            variant="primary"
            onClick={() => setAddOpen(true)}
            type="button"
          >
            + {t("addChannel")}
          </Button>
        </div>
      </div>

      <FormDialog
        open={addOpen}
        title={t("newChannel")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="type">
            {(field) => (
              <NativeSelect
                name="type"
                aria-label="Type"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget
                      .value as NotificationDeliveryChannelType,
                  )
                }
                value={field.state.value}
              >
                {notificationChannelTypes.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            )}
          </form.Field>
          <form.Field name="name" validators={{ onChange: required }}>
            {(field) => (
              <>
                <Input
                  name="name"
                  aria-label={t("channelName")}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("channelName")}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.type}>
            {(type) => (
              <form.Field name="target" validators={{ onChange: required }}>
                {(field) => (
                  <>
                    <Input
                      name="target"
                      aria-label={
                        type === "email"
                          ? "to@example.com"
                          : type === "mobile_push"
                            ? "romeo-secret://device-token"
                            : type === "pagerduty"
                              ? "romeo-secret://routing-key"
                              : "https://…"
                      }
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.currentTarget.value)
                      }
                      placeholder={
                        type === "email"
                          ? "to@example.com"
                          : type === "mobile_push"
                            ? "romeo-secret://device-token"
                            : type === "pagerduty"
                              ? "romeo-secret://routing-key"
                              : "https://…"
                      }
                      value={field.state.value}
                    />
                    {field.state.meta.errors.length ? (
                      <div className="rm-composer-error">
                        {field.state.meta.errors.join(", ")}
                      </div>
                    ) : null}
                  </>
                )}
              </form.Field>
            )}
          </form.Subscribe>
          <form.Subscribe selector={(state) => state.values.type}>
            {(type) =>
              type === "mobile_push" ? (
                <div className="grid grid-cols-2 gap-2">
                  <form.Field name="platform">
                    {(field) => (
                      <NativeSelect
                        name="platform"
                        aria-label="Platform"
                        onChange={(event) =>
                          field.handleChange(
                            event.currentTarget.value as
                              | "android"
                              | "ios"
                              | "web",
                          )
                        }
                        value={field.state.value}
                      >
                        <option value="android">Android</option>
                        <option value="ios">iOS</option>
                        <option value="web">Web</option>
                      </NativeSelect>
                    )}
                  </form.Field>
                  <form.Field name="collapseKey">
                    {(field) => (
                      <Input
                        name="collapseKey"
                        aria-label="Collapse key (optional)"
                        onChange={(event) =>
                          field.handleChange(event.currentTarget.value)
                        }
                        placeholder="Collapse key (optional)"
                        value={field.state.value}
                      />
                    )}
                  </form.Field>
                </div>
              ) : type === "pagerduty" ? (
                <form.Field name="severity">
                  {(field) => (
                    <NativeSelect
                      name="severity"
                      aria-label="Severity"
                      onChange={(event) =>
                        field.handleChange(
                          event.currentTarget.value as
                            | "critical"
                            | "error"
                            | "info"
                            | "warning",
                        )
                      }
                      value={field.state.value}
                    >
                      <option value="critical">Critical</option>
                      <option value="error">Error</option>
                      <option value="warning">Warning</option>
                      <option value="info">Info</option>
                    </NativeSelect>
                  )}
                </form.Field>
              ) : null
            }
          </form.Subscribe>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button disabled={!canSubmit || isSubmitting} type="submit">
                {isSubmitting ? t("creating") : t("createChannel")}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </FormDialog>

      <div className="mt-4">
        <PanelState
          query={channelsQuery}
          empty={t("noChannels")}
          emptyAction={
            <Button
              variant="primary"
              onClick={() => setAddOpen(true)}
              type="button"
            >
              + {t("addChannel")}
            </Button>
          }
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: t("totalChannels"), value: rows.length },
                  {
                    label: t("enabled"),
                    value: rows.filter((row) => row.enabled).length,
                  },
                ]}
              />
              <DataTable columns={channelColumns} data={rows} />
            </div>
          )}
        </PanelState>
      </div>

      <div className="rm-card-header mt-4">
        <div className="rm-card-title">{t("deliveries")}</div>
        <Button
          disabled={deliveriesQuery.isFetching}
          onClick={() => void deliveriesQuery.refetch()}
          type="button"
        >
          {deliveriesQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
      </div>
      <div className="mt-2">
        <DataTable
          columns={deliveryColumns}
          data={deliveriesQuery.data ?? []}
          empty={t("noDeliveries")}
        />
      </div>
    </div>
  );
}
