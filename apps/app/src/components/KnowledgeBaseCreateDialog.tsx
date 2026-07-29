import { Button, Input } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createKnowledgeBase } from "../features";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { FormDialog } from "./FormDialog";

export function KnowledgeBaseCreateDialog({
  onClose,
  onCreated,
  open,
  workspaceId,
}: {
  onClose: () => void;
  onCreated: (knowledgeBaseId: string) => void;
  open: boolean;
  workspaceId: string | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const createMutation = useMutation({ mutationFn: createKnowledgeBase });
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      if (!workspaceId) return;
      try {
        const created = await createMutation.mutateAsync({
          workspaceId,
          name: value.name,
        });
        await queryClient.invalidateQueries({
          queryKey: ["knowledgeBases", workspaceId],
        });
        toast(t("knowledgeBaseCreated"), "success");
        onCreated(created.id);
        form.reset();
        onClose();
      } catch {
        toast(t("knowledgeCouldNotCreateBase"), "error");
      }
    },
  });

  return (
    <FormDialog onClose={onClose} open={open} title={t("knowledgeNewBase")}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <label className="text-sm text-muted" htmlFor="knowledge-name">
          {t("knowledgeBase")}
        </label>
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
