import { Button, Input, NativeSelect } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createKnowledgeBase } from "../features";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { FormDialog } from "./FormDialog";

type KnowledgeScope = "user_private" | "workspace" | "org" | "shared";

export function KnowledgeBaseCreateDialog({
  isAdmin = false,
  onClose,
  onCreated,
  open,
  workspaceId,
}: {
  isAdmin?: boolean;
  onClose: () => void;
  onCreated: (knowledgeBaseId: string) => void;
  open: boolean;
  workspaceId: string | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const createMutation = useMutation({ mutationFn: createKnowledgeBase });
  const form = useForm({
    defaultValues: {
      name: "",
      scope: "workspace" as KnowledgeScope,
    },
    onSubmit: async ({ value }) => {
      if (!workspaceId) return;
      try {
        const created = await createMutation.mutateAsync({
          workspaceId,
          name: value.name.trim(),
          scope: value.scope,
        });
        await queryClient.invalidateQueries({
          queryKey: ["knowledgeBases", workspaceId],
        });
        toast(t("knowledgeBaseCreated"), "success");
        onCreated(created.id);
        form.reset();
        onClose();
      } catch (caught) {
        toast(
          caught instanceof Error
            ? caught.message
            : t("knowledgeCouldNotCreateBase"),
          "error",
        );
      }
    },
  });

  return (
    <FormDialog onClose={onClose} open={open} title={t("knowledgeNewBase")}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <label className="grid gap-1 text-sm" htmlFor="knowledge-name">
          <span className="text-muted">{t("knowledgeBase")}</span>
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("knowledgeNameRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Input
                  name="name"
                  id="knowledge-name"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("knowledgeBaseName")}
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
        </label>
        <label className="grid gap-1 text-sm" htmlFor="knowledge-scope">
          <span className="text-muted">{t("knowledgeScope")}</span>
          <form.Field name="scope">
            {(field) => (
              <NativeSelect
                id="knowledge-scope"
                name="scope"
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget.value as KnowledgeScope,
                  )
                }
                value={field.state.value}
              >
                <option value="user_private">
                  {t("knowledgeScopePrivate")}
                </option>
                <option value="workspace">
                  {t("knowledgeScopeWorkspace")}
                </option>
                {isAdmin ? (
                  <option value="org">{t("knowledgeScopeOrg")}</option>
                ) : null}
                {isAdmin ? (
                  <option value="shared">{t("knowledgeScopeShared")}</option>
                ) : null}
              </NativeSelect>
            )}
          </form.Field>
          <span className="text-xs text-muted">{t("knowledgeScopeHelp")}</span>
        </label>
        <Button
          disabled={!workspaceId || createMutation.isPending}
          type="submit"
        >
          {createMutation.isPending
            ? t("knowledgeCreating")
            : t("knowledgeCreateBase")}
        </Button>
      </form>
    </FormDialog>
  );
}
