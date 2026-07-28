import { Input, Textarea, NativeSelect, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  createPromptTemplate,
  deletePromptTemplate,
  listPromptMarketplace,
  listPromptTemplates,
  updatePromptTemplate,
} from "../features/prompts";
import type {
  CreatePromptTemplateInput,
  PromptTemplate,
  PromptTemplateVisibility,
} from "../features/prompts";
import { PanelState } from "../lib/panel-state";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";
import { useWorkspace } from "./WorkspaceContext";

const templateCol = createColumnHelper<PromptTemplate>();
const marketplaceCol = createColumnHelper<PromptTemplate>();

const visibilities: PromptTemplateVisibility[] = [
  "private",
  "workspace",
  "marketplace",
];

export function PromptTemplatePanel() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  const { ask, dialog } = useConfirm();
  const templatesQuery = useQuery({
    queryKey: ["promptTemplates", workspaceId],
    queryFn: () => listPromptTemplates(workspaceId),
    enabled: workspaceId !== undefined,
  });
  const marketplaceQuery = useQuery({
    queryKey: ["promptMarketplace", workspaceId],
    queryFn: () => listPromptMarketplace(workspaceId),
    enabled: workspaceId !== undefined,
  });
  const createMutation = useMutation({ mutationFn: createPromptTemplate });
  const deleteMutation = useMutation({ mutationFn: deletePromptTemplate });
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);

  const form = useForm({
    defaultValues: {
      name: "",
      body: "",
      visibility: "private" as PromptTemplateVisibility,
    },
    onSubmit: async ({ value }) => {
      if (workspaceId === undefined) {
        toast(t("promptNoWorkspace"), "error");
        return;
      }
      try {
        const input: CreatePromptTemplateInput = {
          workspaceId,
          name: value.name,
          body: value.body,
          visibility: value.visibility,
        };
        await createMutation.mutateAsync(input);
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["promptTemplates", workspaceId],
          }),
          queryClient.invalidateQueries({ queryKey: ["promptMarketplace"] }),
        ]);
        form.reset();
        toast(t("promptTemplateCreated"), "success");
        setAddOpen(false);
      } catch (caught) {
        toast(t("promptCouldNotCreate"), "error");
        throw caught;
      }
    },
  });

  const columns = useMemo<ColumnDef<PromptTemplate, any>[]>(
    () => [
      templateCol.accessor("name", {
        header: t("promptName"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      templateCol.accessor("visibility", {
        header: t("promptVisibility"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {t(visibilityKey(c.getValue()))}
          </span>
        ),
      }),
      templateCol.accessor((row) => row.tags.join(", "), {
        id: "tags",
        header: t("promptTags"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      }),
      templateCol.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <div className="flex items-center gap-2">
            <Button onClick={() => setEditing(c.row.original)} type="button">
              {t("promptEditTemplate")}
            </Button>
            <Button
              disabled={deleteMutation.isPending}
              onClick={() => void handleDelete(c.row.original.id)}
              type="button"
            >
              {t("delete")}
            </Button>
          </div>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteMutation.isPending, t],
  );

  const marketplaceColumns = useMemo<ColumnDef<PromptTemplate, any>[]>(
    () => [
      marketplaceCol.accessor("name", {
        header: t("promptName"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      marketplaceCol.accessor((row) => row.description ?? "", {
        id: "description",
        header: t("promptDescription"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      }),
      marketplaceCol.accessor((row) => row.tags.join(", "), {
        id: "tags",
        header: t("promptTags"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      }),
    ],
    [t],
  );

  async function handleDelete(promptTemplateId: string) {
    if (
      !(await ask({
        title: t("promptDeleteTemplateTitle"),
        confirmLabel: t("delete"),
        tone: "danger",
      }))
    )
      return;
    try {
      await deleteMutation.mutateAsync(promptTemplateId);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["promptTemplates", workspaceId],
        }),
        queryClient.invalidateQueries({ queryKey: ["promptMarketplace"] }),
      ]);
      toast(t("promptTemplateRemoved"), "success");
    } catch {
      toast(t("promptCouldNotRemove"), "error");
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="rm-card-title">{t("promptTemplates")}</div>
        <Button
          variant="primary"
          onClick={() => setAddOpen(true)}
          type="button"
        >
          + {t("promptAddTemplate")}
        </Button>
      </div>
      <FormDialog
        open={addOpen}
        title={t("promptNewTemplate")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("promptNameRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Input
                  name="name"
                  aria-label={t("promptTemplateName")}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("promptTemplateName")}
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
          <form.Field
            name="body"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("promptBodyRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Textarea
                  name="body"
                  aria-label={t("promptTemplateBody")}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("promptTemplateBody")}
                  rows={4}
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
          <form.Field name="visibility">
            {(field) => (
              <NativeSelect
                name="visibility"
                aria-label="Visibility"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget.value as PromptTemplateVisibility,
                  )
                }
                value={field.state.value}
              >
                {visibilities.map((option) => (
                  <option key={option} value={option}>
                    {t(visibilityKey(option))}
                  </option>
                ))}
              </NativeSelect>
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button disabled={!canSubmit || isSubmitting} type="submit">
                {isSubmitting ? t("promptCreating") : t("promptCreateTemplate")}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </FormDialog>
      {editing !== null && workspaceId !== undefined ? (
        <PromptTemplateEditDialog
          key={editing.id}
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: ["promptTemplates", workspaceId],
              }),
              queryClient.invalidateQueries({
                queryKey: ["promptMarketplace", workspaceId],
              }),
            ]);
            setEditing(null);
          }}
        />
      ) : null}
      <div className="mt-4">
        <PanelState
          query={templatesQuery}
          empty={t("promptNoTemplates")}
          emptyAction={
            <Button
              variant="primary"
              onClick={() => setAddOpen(true)}
              type="button"
            >
              + {t("promptAddTemplate")}
            </Button>
          }
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: t("promptTotalTemplates"), value: rows.length },
                  {
                    label: t("promptMarketplace"),
                    value: rows.filter(
                      (row) => row.visibility === "marketplace",
                    ).length,
                  },
                ]}
              />
              <DataTable columns={columns} data={rows} />
            </div>
          )}
        </PanelState>
      </div>
      <div className="rm-card-title mt-6">{t("promptMarketplace")}</div>
      <div className="mt-3">
        <PanelState
          query={marketplaceQuery}
          empty={t("promptNoMarketplaceTemplates")}
        >
          {(rows) => <DataTable columns={marketplaceColumns} data={rows} />}
        </PanelState>
      </div>
      {dialog}
    </section>
  );
}

function PromptTemplateEditDialog({
  template,
  onClose,
  onSaved,
}: {
  template: PromptTemplate;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const editForm = useForm({
    defaultValues: {
      name: template.name,
      body: template.body,
      visibility: template.visibility,
    },
    onSubmit: async ({ value }) => {
      try {
        await updatePromptTemplate(template.id, {
          name: value.name,
          body: value.body,
          visibility: value.visibility,
        });
        toast(t("promptTemplateUpdated"), "success");
        await onSaved();
      } catch (caught) {
        toast(t("promptCouldNotUpdate"), "error");
        throw caught;
      }
    },
  });

  return (
    <FormDialog open title={t("promptEditTemplate")} onClose={onClose}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void editForm.handleSubmit();
        }}
      >
        <editForm.Field
          name="name"
          validators={{
            onChange: ({ value }: { value: string }) =>
              !value?.trim() ? t("promptNameRequired") : undefined,
          }}
        >
          {(field) => (
            <>
              <Input
                name="name"
                aria-label={t("promptTemplateName")}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("promptTemplateName")}
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">
                  {field.state.meta.errors.join(", ")}
                </div>
              ) : null}
            </>
          )}
        </editForm.Field>
        <editForm.Field
          name="body"
          validators={{
            onChange: ({ value }: { value: string }) =>
              !value?.trim() ? t("promptBodyRequired") : undefined,
          }}
        >
          {(field) => (
            <>
              <Textarea
                name="body"
                aria-label={t("promptTemplateBody")}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("promptTemplateBody")}
                rows={4}
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">
                  {field.state.meta.errors.join(", ")}
                </div>
              ) : null}
            </>
          )}
        </editForm.Field>
        <editForm.Field name="visibility">
          {(field) => (
            <NativeSelect
              name="visibility"
              aria-label="Visibility"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(
                  event.currentTarget.value as PromptTemplateVisibility,
                )
              }
              value={field.state.value}
            >
              {visibilities.map((option) => (
                <option key={option} value={option}>
                  {t(visibilityKey(option))}
                </option>
              ))}
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
              {isSubmitting ? t("promptSaving") : t("promptSaveTemplate")}
            </Button>
          )}
        </editForm.Subscribe>
      </form>
    </FormDialog>
  );
}

function visibilityKey(
  visibility: PromptTemplateVisibility,
):
  | "promptVisibilityMarketplace"
  | "promptVisibilityPrivate"
  | "promptVisibilityWorkspace" {
  if (visibility === "marketplace") return "promptVisibilityMarketplace";
  if (visibility === "workspace") return "promptVisibilityWorkspace";
  return "promptVisibilityPrivate";
}
