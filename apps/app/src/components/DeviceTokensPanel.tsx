import { Input, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  createDeviceAuthorizationMutationOptions,
  type CreateDeviceAuthorizationRequest,
  type CreatedDeviceAuthorization,
  type DeviceAuthorization,
  revokeDeviceAuthorizationMutationOptions,
} from "../features/device-authorizations";
import { useLocale, type MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDate } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { AddButton, Section, StatRow } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const col = createColumnHelper<DeviceAuthorization>();

const scopeOptions = [
  "me:read",
  "tools:use",
  "tools:manage",
  "audit:read",
  "webhooks:read",
  "webhooks:write",
] as const satisfies readonly CreateDeviceAuthorizationRequest["scopes"][number][];

function authorizationStatus(
  authorization: DeviceAuthorization,
): "active" | "expired" | "revoked" {
  if (authorization.revokedAt !== undefined) return "revoked";
  if (new Date(authorization.expiresAt).getTime() <= Date.now())
    return "expired";
  return "active";
}

export function DeviceTokensPanel() {
  const { t } = useLocale();
  const inventoriedTable = useInventoriedServerTable<DeviceAuthorization>(
    "device_tokens",
  );
  const { ask, dialog } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [created, setCreated] = useState<CreatedDeviceAuthorization>();
  const createMutation = useMutation(
    createDeviceAuthorizationMutationOptions(),
  );
  const revokeMutation = useMutation(
    revokeDeviceAuthorizationMutationOptions(),
  );

  const tokenForm = useForm({
    defaultValues: {
      name: "",
      scopes: ["me:read"] as CreateDeviceAuthorizationRequest["scopes"],
      ttlDays: 90,
    },
    onSubmit: async ({ value }) => {
      try {
        const result = await createMutation.mutateAsync({
          name: value.name,
          scopes: value.scopes,
          ttlDays: value.ttlDays,
        });
        setCreated(result);
        createMutation.reset();
        toast(t("deviceTokensCreated"), "success");
        setAddOpen(false);
        tokenForm.reset();
      } catch {
        toast(t("deviceTokensCouldNotCreate"), "error");
      }
    },
  });

  async function handleRevoke(deviceAuthorizationId: string) {
    if (
      !(await ask({
        title: t("deviceTokensRevokeTitle"),
        body: t("deviceTokensRevokeBody"),
        confirmLabel: t("deviceTokensRevoke"),
        tone: "danger",
      }))
    )
      return;
    try {
      await revokeMutation.mutateAsync(deviceAuthorizationId);
      toast(t("deviceTokensRevokedToast"), "success");
    } catch {
      toast(t("deviceTokensCouldNotRevoke"), "error");
    }
  }

  const columns = useMemo<ColumnDef<DeviceAuthorization, any>[]>(
    () => [
      col.accessor("name", {
        header: t("deviceTokensName"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      col.accessor((row) => row.scopes.join(", "), {
        id: "scopes",
        header: t("deviceTokensScopes"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
        ),
      }),
      col.accessor("createdAt", {
        header: t("deviceTokensCreatedAt"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDate value={c.getValue()} />
          </span>
        ),
      }),
      col.accessor((row) => row.expiresAt, {
        id: "expires",
        header: t("deviceTokensExpires"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDate value={c.getValue()} />
          </span>
        ),
      }),
      col.accessor((row) => authorizationStatus(row), {
        id: "status",
        header: t("deviceTokensStatus"),
        cell: (c) => (
          <span
            className={`rm-status ${c.getValue() === "active" ? "pass" : "fail"}`}
          >
            {t(deviceTokenStatusMessageKey(c.getValue()))}
          </span>
        ),
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <Button
            disabled={
              c.row.original.revokedAt !== undefined || revokeMutation.isPending
            }
            onClick={() => void handleRevoke(c.row.original.id)}
            type="button"
          >
            {c.row.original.revokedAt
              ? t("deviceTokensRevoked")
              : t("deviceTokensRevoke")}
          </Button>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revokeMutation.isPending, t],
  );

  return (
    <Section
      actions={
        <AddButton onClick={() => setAddOpen(true)}>
          {t("deviceTokensAdd")}
        </AddButton>
      }
      title={t("deviceTokensTitle")}
    >
      {created ? (
        <div
          className="mt-3 grid gap-2 rounded-md border border-border p-2 text-sm"
          role="status"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-muted">{t("deviceTokensStoreNow")}</div>
            <Button onClick={() => setCreated(undefined)} type="button">
              {t("dismiss")}
            </Button>
          </div>
          <div>
            <div className="text-muted">{t("deviceTokensAccessToken")}</div>
            <div className="break-all font-mono">{created.accessToken}</div>
          </div>
          <div>
            <div className="text-muted">{t("deviceTokensRefreshToken")}</div>
            <div className="break-all font-mono">{created.refreshToken}</div>
          </div>
        </div>
      ) : null}

      <PanelState
        query={inventoriedTable.query}
        empty={t("deviceTokensNone")}
        emptyAction={
          <AddButton onClick={() => setAddOpen(true)}>
            {t("deviceTokensAdd")}
          </AddButton>
        }
        isEmpty={() =>
          inventoriedTable.rows.length === 0 &&
          inventoriedTable.isFirstPage &&
          inventoriedTable.search.trim() === ""
        }
      >
        {() => (
          <div className="grid gap-4">
            <StatRow
              items={[
                {
                  label: t("deviceTokensTotal"),
                  value: inventoriedTable.estimatedTotal,
                },
                {
                  label: t("deviceTokensRevokedExpired"),
                  value: inventoriedTable.rows.filter(
                    (row) => authorizationStatus(row) !== "active",
                  ).length,
                },
              ]}
            />
            <DataTable
              serverState={inventoriedTable.serverState}
              columns={columns}
              data={inventoriedTable.rows}
              empty={t("deviceTokensNone")}
            />
          </div>
        )}
      </PanelState>

      <FormDialog
        open={addOpen}
        title={t("deviceTokensNew")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void tokenForm.handleSubmit();
          }}
        >
          <label className="text-sm text-muted" htmlFor="device-token-name">
            {t("deviceTokensTokenName")}
          </label>
          <tokenForm.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("deviceTokensNameRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Input
                  name="name"
                  id="device-token-name"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("deviceTokensNameExample")}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error" role="alert">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </tokenForm.Field>
          <label className="text-sm text-muted" htmlFor="device-token-ttl">
            {t("deviceTokensExpiresDays")}
          </label>
          <tokenForm.Field name="ttlDays">
            {(field) => (
              <Input
                name="ttlDays"
                id="device-token-ttl"
                min={1}
                max={365}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(Number(event.currentTarget.value))
                }
                type="number"
                value={field.state.value}
              />
            )}
          </tokenForm.Field>
          <tokenForm.Field name="scopes">
            {(field) => (
              <div className="grid gap-2 text-sm">
                {scopeOptions.map((scope) => (
                  <label className="flex items-center gap-2" key={scope}>
                    <Input
                      name="scopes"
                      checked={field.state.value.includes(scope)}
                      onChange={() => {
                        const current = field.state.value;
                        field.handleChange(
                          current.includes(scope)
                            ? current.filter((item) => item !== scope)
                            : [...current, scope],
                        );
                      }}
                      type="checkbox"
                    />
                    <span>{scope}</span>
                  </label>
                ))}
              </div>
            )}
          </tokenForm.Field>
          <tokenForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
              scopes: state.values.scopes,
            })}
          >
            {({ canSubmit, isSubmitting, scopes }) => (
              <Button
                disabled={!canSubmit || isSubmitting || scopes.length === 0}
                type="submit"
              >
                {isSubmitting
                  ? t("deviceTokensCreating")
                  : t("deviceTokensCreate")}
              </Button>
            )}
          </tokenForm.Subscribe>
        </form>
      </FormDialog>
      {dialog}
    </Section>
  );
}

function deviceTokenStatusMessageKey(
  status: ReturnType<typeof authorizationStatus>,
): MessageKey {
  if (status === "active") return "deviceTokensStatusActive";
  if (status === "expired") return "deviceTokensStatusExpired";
  return "deviceTokensStatusRevoked";
}
