import { Button, Field, Input, NativeSelect, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";

import {
  updatePromptTemplateMutationOptions,
  type PromptTemplate,
  type PromptTemplateVisibility,
} from "../features/prompts";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { FormDialog } from "./FormDialog";
import { parsePromptTemplateTags } from "./prompt-template-fields";
import {
  promptTemplateVisibilities,
  promptTemplateVisibilityKey,
} from "./prompt-template-visibility";

export function PromptTemplateEditDialog({
  template,
  workspaceId,
  onClose,
  onSaved,
}: {
  template: PromptTemplate;
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const updateMutation = useMutation(updatePromptTemplateMutationOptions());
  const editForm = useForm({
    defaultValues: {
      name: template.name,
      description: template.description ?? "",
      tags: template.tags.join(", "),
      body: template.body,
      visibility: template.visibility,
    },
    onSubmit: async ({ value }) => {
      try {
        await updateMutation.mutateAsync({
          promptTemplateId: template.id,
          workspaceId,
          update: {
            name: value.name,
            description:
              value.description.trim().length === 0
                ? null
                : value.description.trim(),
            body: value.body,
            tags: parsePromptTemplateTags(value.tags),
            visibility: value.visibility,
          },
        });
        toast(t("promptTemplateUpdated"), "success");
        onSaved();
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
        <editForm.Field name="description">
          {(field) => (
            <Field label={t("promptDescription")}>
              <Textarea
                name="description"
                maxLength={500}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                rows={2}
                value={field.state.value}
              />
            </Field>
          )}
        </editForm.Field>
        <editForm.Field name="tags">
          {(field) => (
            <Field description={t("promptTagsHelp")} label={t("promptTags")}>
              <Input
                name="tags"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                value={field.state.value}
              />
            </Field>
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
            <Field label={t("promptVisibility")}>
              <NativeSelect
                name="visibility"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget.value as PromptTemplateVisibility,
                  )
                }
                value={field.state.value}
              >
                {promptTemplateVisibilities.map((option) => (
                  <option key={option} value={option}>
                    {t(promptTemplateVisibilityKey(option))}
                  </option>
                ))}
              </NativeSelect>
            </Field>
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
