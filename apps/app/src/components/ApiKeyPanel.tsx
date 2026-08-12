import { Input, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import KeyRound from "lucide-react/dist/esm/icons/key-round.mjs";
import { useMemo, useState } from "react";

import {
  bulkRevokeApiKeys,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../features";
import { PanelState } from "../lib/panel-state";
import { LocalizedDate, LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import type { ApiKeyScope, ApiKeySummary } from "../features/administration";
import { AddButton, Section, StatRow } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { Drawer } from "./Drawer";
import { FormDialog } from "./FormDialog";
import { OverflowMenu } from "./OverflowMenu";
import { SecretRevealCard } from "./SecretRevealCard";

const col = createColumnHelper<ApiKeySummary>();

const scopeOptions = [
  "me:read",
  "tools:use",
  "tools:manage",
  "audit:read",
  "webhooks:read",
  "webhooks:write",
] as const satisfies readonly ApiKeyScope[];

export function ApiKeyPanel() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string>();
  const [detailKey, setDetailKey] = useState<ApiKeySummary>();
  const apiKeysQuery = useQuery({
    queryKey: ["apiKeys"],
    queryFn: listApiKeys,
  });
  const createMutation = useMutation({ mutationFn: createApiKey });
  const revokeMutation = useMutation({ mutationFn: revokeApiKey });
  const bulkRevokeMutation = useMutation({ mutationFn: bulkRevokeApiKeys });

  const ApiKeyForm = useForm({
    defaultValues: { name: "", scopes: ["me:read"] as ApiKeyScope[] },
    onSubmit: async ({ value }) => {
      try {
        const created = await createMutation.mutateAsync({
          name: value.name,
          scopes: value.scopes,
        });
        setCreatedToken(created.token);
        await queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
        toast(t("apiKeyCreated"), "success");
        setAddOpen(false);
        ApiKeyForm.reset();
      } catch {
        toast(t("couldNotCreateApiKey"), "error");
      }
    },
  });

  async function handleRevoke(apiKeyId: string) {
    if (
      !(await ask({
        title: t("revokeApiKeyTitle"),
        body: t("anythingUsingKeyStops"),
        confirmLabel: t("revoke"),
        tone: "danger",
      }))
    )
      return;
    try {
      await revokeMutation.mutateAsync(apiKeyId);
      await queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
      setDetailKey((current) =>
        current?.id === apiKeyId ? undefined : current,
      );
      toast(t("apiKeyRevoked"), "success");
    } catch {
      toast(t("couldNotRevokeApiKey"), "error");
    }
  }

  async function handleBulkRevoke(
    apiKeyIds: string[],
    clearSelection: () => void,
  ) {
    if (apiKeyIds.length === 0) return;
    if (
      !(await ask({
        title: `${t("revoke")} ${apiKeyIds.length} ${t("apiKeys")}?`,
        body: t("anythingUsingKeysStops"),
        confirmLabel: t("revoke"),
        tone: "danger",
      }))
    )
      return;
    try {
      const result = await bulkRevokeMutation.mutateAsync(apiKeyIds);
      await queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
      clearSelection();
      const failed = result.results.filter(
        (item) => item.status === "failure",
      ).length;
      if (failed > 0) {
        toast(
          `${t("revoke")} ${result.results.length - failed}, ${failed} ${t("failedCount")}`,
          "error",
        );
      } else {
        toast(
          `${t("revoke")} ${result.results.length} ${t("apiKeys")}`,
          "success",
        );
      }
    } catch {
      toast(t("couldNotRevokeApiKeys"), "error");
    }
  }

  const columns = useMemo<ColumnDef<ApiKeySummary, any>[]>(
    () => [
      col.accessor("name", {
        header: t("name"),
        cell: (c) => (
          <Button
            className="font-medium underline-offset-2 hover:underline"
            onClick={() => setDetailKey(c.row.original)}
            type="button"
          >
            {c.getValue()}
          </Button>
        ),
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
      col.accessor("createdAt", {
        header: t("created"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDate value={c.getValue()} />
          </span>
        ),
      }),
      col.accessor((row) => (row.revokedAt ? "revoked" : "active"), {
        id: "status",
        header: t("status"),
        cell: (c) => (
          <span
            className={`rm-status ${c.getValue() === "active" ? "pass" : "fail"}`}
          >
            {c.getValue() === "active" ? t("active") : t("revokedStatus")}
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
                label: t("details"),
                onClick: () => setDetailKey(c.row.original),
              },
              {
                label: t("revoke"),
                tone: "danger",
                disabled:
                  c.row.original.revokedAt !== undefined ||
                  revokeMutation.isPending,
                onClick: () => void handleRevoke(c.row.original.id),
              },
            ]}
          />
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revokeMutation.isPending, t],
  );

  return (
    <Section
      actions={
        (apiKeysQuery.data?.length ?? 0) > 0 ? (
          <AddButton onClick={() => setAddOpen(true)}>
            {t("addApiKey")}
          </AddButton>
        ) : null
      }
      title={t("apiKeys")}
    >
      {createdToken ? (
        <SecretRevealCard
          label={t("token")}
          onDismiss={() => setCreatedToken(undefined)}
          secret={createdToken}
        />
      ) : null}

      <PanelState
        empty={t("noApiKeys")}
        emptyAction={
          <AddButton onClick={() => setAddOpen(true)}>
            {t("addApiKey")}
          </AddButton>
        }
        emptyDescription={t("noApiKeysDescription")}
        emptyIcon={<KeyRound aria-hidden size={24} />}
        query={apiKeysQuery}
      >
        {(apiKeys) => (
          <div className="grid gap-4">
            <StatRow
              items={[
                { label: t("totalKeys"), value: apiKeys.length },
                {
                  label: t("revokedStatus"),
                  value: apiKeys.filter((k) => k.revokedAt).length,
                },
              ]}
            />
            <DataTable
              columns={columns}
              data={apiKeys}
              empty={t("noApiKeys")}
              enableRowSelection
              getRowId={(row) => row.id}
              bulkActions={(ids, clear) => (
                <Button
                  variant="danger"
                  disabled={bulkRevokeMutation.isPending}
                  onClick={() => void handleBulkRevoke(ids, clear)}
                  type="button"
                >
                  {bulkRevokeMutation.isPending
                    ? t("revoking")
                    : `${t("revoke")} ${ids.length}`}
                </Button>
              )}
            />
          </div>
        )}
      </PanelState>

      <FormDialog
        open={addOpen}
        title={t("newApiKey")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void ApiKeyForm.handleSubmit();
          }}
        >
          <label className="text-sm text-muted" htmlFor="api-key-name">
            {t("apiKeyName")}
          </label>
          <ApiKeyForm.Field
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
                  id="api-key-name"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("productionIntegration")}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </ApiKeyForm.Field>
          <ApiKeyForm.Field name="scopes">
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
          </ApiKeyForm.Field>
          <ApiKeyForm.Subscribe
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
                {isSubmitting ? t("creating") : t("createKey")}
              </Button>
            )}
          </ApiKeyForm.Subscribe>
        </form>
      </FormDialog>

      <Drawer
        open={detailKey !== undefined}
        title={detailKey?.name ?? ""}
        description={t("apiKeyDetails")}
        onClose={() => setDetailKey(undefined)}
      >
        {detailKey ? (
          <div className="grid gap-4">
            <dl className="grid gap-3 text-sm">
              <div className="grid gap-0.5">
                <dt className="text-muted">{t("keyId")}</dt>
                <dd className="break-all font-mono">{detailKey.id}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted">{t("name")}</dt>
                <dd className="font-medium">{detailKey.name}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted">{t("scopes")}</dt>
                <dd className="font-mono">
                  {detailKey.scopes.join(", ") || "—"}
                </dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted">{t("created")}</dt>
                <dd>
                  <LocalizedDateTime value={detailKey.createdAt} />
                </dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted">{t("status")}</dt>
                <dd>
                  <span
                    className={`rm-status ${detailKey.revokedAt ? "fail" : "pass"}`}
                  >
                    {detailKey.revokedAt ? t("revokedStatus") : t("active")}
                  </span>
                </dd>
              </div>
              {detailKey.revokedAt ? (
                <div className="grid gap-0.5">
                  <dt className="text-muted">{t("revokedStatus")}</dt>
                  <dd>
                    <LocalizedDateTime value={detailKey.revokedAt} />
                  </dd>
                </div>
              ) : null}
            </dl>
            <div>
              <Button
                variant="danger"
                disabled={
                  detailKey.revokedAt !== undefined || revokeMutation.isPending
                }
                onClick={() => void handleRevoke(detailKey.id)}
                type="button"
              >
                {detailKey.revokedAt ? t("revokedStatus") : t("revokeKey")}
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>
      {dialog}
    </Section>
  );
}
