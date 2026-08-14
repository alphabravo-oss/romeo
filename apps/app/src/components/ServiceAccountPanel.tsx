import { Input, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import KeyRound from "lucide-react/dist/esm/icons/key-round.mjs";
import { useMemo, useState } from "react";


import {
  bulkDisableServiceAccountsMutationOptions,
  createServiceAccountApiKeyMutationOptions,
  createServiceAccountMutationOptions,
  disableServiceAccountMutationOptions,
} from "../features/administration/mutation-options";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import type { ApiKeyScope, ServiceAccount } from "../features/administration";
import { Section, StatRow } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { OverflowMenu } from "./OverflowMenu";
import { SecretRevealCard } from "./SecretRevealCard";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const serviceAccountScopes = [
  "me:read",
  "tools:use",
  "knowledge:query",
  "runs:create",
  "webhooks:read",
  "webhooks:write",
] as const satisfies readonly ApiKeyScope[];

const col = createColumnHelper<ServiceAccount>();

export function ServiceAccountPanel() {
  const { t } = useLocale();
  const { ask, dialog } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string>();
  const table = useInventoriedServerTable<ServiceAccount>("service_accounts");
  const createMutation = useMutation(createServiceAccountMutationOptions());
  const keyMutation = useMutation(createServiceAccountApiKeyMutationOptions());
  const disableMutation = useMutation(disableServiceAccountMutationOptions());
  const bulkDisableMutation = useMutation(
    bulkDisableServiceAccountsMutationOptions(),
  );

  const ServiceAccountForm = useForm({
    defaultValues: {
      name: "",
      keyName: "",
      scopes: ["me:read", "tools:use"] as ApiKeyScope[],
    },
    onSubmit: async ({ value }) => {
      try {
        const account = await createMutation.mutateAsync({
          name: value.name,
          scopes: value.scopes,
        });
        const key = await keyMutation.mutateAsync({
          serviceAccountId: account.id,
          name: value.keyName,
          scopes: value.scopes,
        });
        setCreatedToken(key.token);
        toast(t("serviceAccountCreated"), "success");
        setAddOpen(false);
        ServiceAccountForm.reset();
      } catch {
        toast(t("couldNotCreateServiceAccount"), "error");
      }
    },
  });

  async function handleCreateKey(account: ServiceAccount) {
    if (
      !(await ask({
        title: t("createKey"),
        body: t("anythingUsingKeyStops"),
        confirmLabel: t("createKey"),
        tone: "danger",
      }))
    )
      return;
    try {
      const key = await keyMutation.mutateAsync({
        serviceAccountId: account.id,
        name: `${account.name} key`,
        scopes: account.scopes,
      });
      setCreatedToken(key.token);
      toast(t("apiKeyCreated"), "success");
    } catch {
      toast(t("couldNotCreateApiKey"), "error");
    }
  }

  async function handleDisable(serviceAccountId: string) {
    if (
      !(await ask({
        title: t("disableServiceAccountTitle"),
        body: t("theyLoseAccess"),
        confirmLabel: t("disable"),
        tone: "danger",
      }))
    )
      return;
    try {
      await disableMutation.mutateAsync(serviceAccountId);
      toast(t("serviceAccountDisabled"), "success");
    } catch {
      toast(t("couldNotDisableServiceAccount"), "error");
    }
  }

  async function handleBulkDisable(
    serviceAccountIds: string[],
    clearSelection: () => void,
  ) {
    if (serviceAccountIds.length === 0) return;
    if (
      !(await ask({
        title: `${t("disable")} ${serviceAccountIds.length} ${t("serviceAccounts")}?`,
        body: t("theyLoseAccess"),
        confirmLabel: t("disable"),
        tone: "danger",
      }))
    )
      return;
    try {
      const result = await bulkDisableMutation.mutateAsync(serviceAccountIds);
      clearSelection();
      const failed = result.results.filter(
        (item) => item.status === "failure",
      ).length;
      if (failed > 0) {
        toast(
          `${t("disable")} ${result.results.length - failed}, ${failed} ${t("failedCount")}`,
          "error",
        );
      } else {
        toast(
          `${t("disable")} ${result.results.length} ${t("serviceAccounts")}`,
          "success",
        );
      }
    } catch {
      toast(t("couldNotDisableServiceAccounts"), "error");
    }
  }

  const columns = useMemo<ColumnDef<ServiceAccount, any>[]>(
    () => [
      col.accessor("name", {
        header: t("name"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      col.accessor((row) => row.scopes.join(", "), {
        id: "scopes",
        header: t("scopes"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      col.accessor((row) => (row.disabledAt ? "disabled" : "active"), {
        id: "status",
        header: t("status"),
        cell: (c) => (
          <span
            className={`rm-status ${c.getValue() === "active" ? "pass" : "fail"}`}
          >
            {c.getValue() === "active" ? t("active") : t("disabled")}
          </span>
        ),
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <OverflowMenu
            items={[
              {
                label: t("createKey"),
                disabled:
                  keyMutation.isPending ||
                  c.row.original.disabledAt !== undefined,
                onClick: () => void handleCreateKey(c.row.original),
              },
              {
                label: t("disable"),
                tone: "danger",
                disabled:
                  disableMutation.isPending ||
                  c.row.original.disabledAt !== undefined,
                onClick: () => void handleDisable(c.row.original.id),
              },
            ]}
          />
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disableMutation.isPending, keyMutation.isPending, t],
  );

  return (
    <Section
      actions={
        <Button
          variant="secondary"
          onClick={() => setAddOpen(true)}
          type="button"
        >
          + {t("addServiceAccount")}
        </Button>
      }
      title={t("serviceAccounts")}
    >
      {createdToken ? (
        <SecretRevealCard
          label={t("token")}
          onDismiss={() => setCreatedToken(undefined)}
          secret={createdToken}
        />
      ) : null}
      <PanelState
        empty={t("noServiceAccounts")}
        emptyAction={
          <Button
            onClick={() => setAddOpen(true)}
            type="button"
            variant="secondary"
          >
            + {t("addServiceAccount")}
          </Button>
        }
        emptyDescription={t("noServiceAccountsDescription")}
        emptyIcon={<KeyRound aria-hidden size={24} />}
        isEmpty={(page) =>
          page.items.length === 0 &&
          table.isFirstPage &&
          table.search.trim() === ""
        }
        query={table.query}
      >
        {() => (
          <div className="grid gap-4">
            <StatRow
              items={[
                {
                  label: t("totalAccounts"),
                  value: table.summary.total ?? table.estimatedTotal,
                },
                {
                  label: t("disabled"),
                  value: table.summary.disabledTotal ?? 0,
                },
              ]}
            />
            <DataTable
              serverState={table.serverState}
              columns={columns}
              data={table.rows}
              empty={t("noServiceAccounts")}
              enableRowSelection
              getRowId={(row) => row.id}
              bulkActions={(ids, clear) => (
                <Button
                  variant="danger"
                  disabled={bulkDisableMutation.isPending}
                  onClick={() => void handleBulkDisable(ids, clear)}
                  type="button"
                >
                  {bulkDisableMutation.isPending
                    ? t("disabling")
                    : `${t("disable")} ${ids.length}`}
                </Button>
              )}
            />
          </div>
        )}
      </PanelState>
      <FormDialog
        open={addOpen}
        title={t("newServiceAccount")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void ServiceAccountForm.handleSubmit();
          }}
        >
          <label className="text-sm text-muted" htmlFor="service-account-name">
            {t("name")}
          </label>
          <ServiceAccountForm.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("nameRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Input
                  name="name"
                  id="service-account-name"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("toolWorker")}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error" role="alert">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </ServiceAccountForm.Field>
          <label
            className="text-sm text-muted"
            htmlFor="service-account-key-name"
          >
            {t("keyName")}
          </label>
          <ServiceAccountForm.Field name="keyName">
            {(field) => (
              <Input
                name="keyName"
                id="service-account-key-name"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("toolWorkerKey")}
                value={field.state.value}
              />
            )}
          </ServiceAccountForm.Field>
          <ServiceAccountForm.Field name="scopes">
            {(field) => (
              <div className="grid gap-2 text-sm">
                {serviceAccountScopes.map((scope) => (
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
          </ServiceAccountForm.Field>
          <ServiceAccountForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
              scopes: state.values.scopes,
            })}
          >
            {({ canSubmit, isSubmitting, scopes }) => (
              <Button
                disabled={
                  !canSubmit ||
                  isSubmitting ||
                  scopes.length === 0 ||
                  createMutation.isPending ||
                  keyMutation.isPending
                }
                type="submit"
              >
                {isSubmitting ||
                createMutation.isPending ||
                keyMutation.isPending
                  ? t("creating")
                  : t("createServiceAccount")}
              </Button>
            )}
          </ServiceAccountForm.Subscribe>
        </form>
      </FormDialog>
      {dialog}
    </Section>
  );
}
