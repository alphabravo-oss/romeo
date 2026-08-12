import { Button, Field, Input, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  getChatExperience,
  updateChatExperience,
  type ChatExperience,
} from "../features/chat-experience";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";

export function ChatExperiencePanel() {
  const query = useQuery({
    queryKey: ["chatExperience"],
    queryFn: getChatExperience,
  });
  const { t } = useLocale();

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div>
          <div className="rm-card-title">{t("chatExperienceSettings")}</div>
          <p className="text-sm text-muted">
            {t("chatExperienceSettingsDescription")}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <PanelState query={query} isEmpty={() => false}>
          {(settings) => (
            <ChatExperienceForm
              initial={settings}
              key={JSON.stringify(settings)}
            />
          )}
        </PanelState>
      </div>
    </section>
  );
}

function ChatExperienceForm({ initial }: { initial: ChatExperience }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: updateChatExperience });
  const [openPromptIndexes, setOpenPromptIndexes] = useState<Set<number>>(
    () => new Set(),
  );
  const form = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(value);
        await queryClient.invalidateQueries({ queryKey: ["chatExperience"] });
        toast(t("chatExperienceSaved"), "success");
      } catch (caught) {
        toast(
          caught instanceof Error
            ? caught.message
            : t("chatExperienceSaveFailed"),
          "error",
        );
      }
    },
  });

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="assistantsEnabled">
        {(field) => (
          <label
            className="flex items-start gap-3 rounded-md border border-border p-3"
            htmlFor="chat-assistants-enabled"
          >
            <Input
              checked={field.state.value}
              id="chat-assistants-enabled"
              name="assistantsEnabled"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.checked)
              }
              type="checkbox"
            />
            <span>
              <strong className="block text-sm">
                {t("chatAssistantsLabel")}
              </strong>
              <span className="mt-1 block text-sm text-muted">
                {t("chatAssistantsDescription")}
              </span>
            </span>
          </label>
        )}
      </form.Field>

      <form.Field name="autoTitleEnabled">
        {(field) => (
          <label
            className="flex items-start gap-3 rounded-md border border-border p-3"
            htmlFor="chat-auto-title"
          >
            <Input
              checked={field.state.value}
              id="chat-auto-title"
              name="autoTitleEnabled"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.checked)
              }
              type="checkbox"
            />
            <span>
              <strong className="block text-sm">
                {t("chatAutoTitleLabel")}
              </strong>
              <span className="mt-1 block text-sm text-muted">
                {t("chatAutoTitleDescription")}
              </span>
            </span>
          </label>
        )}
      </form.Field>

      <form.Field mode="array" name="suggestions">
        {(suggestionsField) => (
          <div className="grid gap-3">
            <div className="rm-card-header">
              <div>
                <div className="font-medium">{t("chatStarterPrompts")}</div>
                <p className="text-sm text-muted">
                  {t("chatStarterPromptsDescription")}
                </p>
              </div>
              <Button
                disabled={suggestionsField.state.value.length >= 8}
                onClick={() => {
                  const nextIndex = suggestionsField.state.value.length;
                  setOpenPromptIndexes((current) => {
                    const next = new Set(current);
                    next.add(nextIndex);
                    return next;
                  });
                  suggestionsField.pushValue({ title: "", prompt: "" });
                }}
                type="button"
              >
                {t("chatAddStarter")}
              </Button>
            </div>

            {suggestionsField.state.value.length === 0 ? (
              <div className="rm-empty">{t("chatNoStarters")}</div>
            ) : null}

            {suggestionsField.state.value.map((suggestion, index) => (
              <details
                className="rm-starter-prompt"
                key={index}
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setOpenPromptIndexes((current) => {
                    if (current.has(index) === open) return current;
                    const next = new Set(current);
                    if (open) next.add(index);
                    else next.delete(index);
                    return next;
                  });
                }}
                open={openPromptIndexes.has(index)}
              >
                <summary className="rm-starter-prompt__summary">
                  <span className="rm-starter-prompt__label">
                    {suggestion.title.trim() === ""
                      ? t("chatStarterUntitled")
                      : suggestion.title}
                  </span>
                </summary>
                <div className="rm-starter-prompt__body">
                  <span className="sr-only">
                    {t("chatStarterPrompt")} {index + 1}
                  </span>
                  <form.Field
                    name={`suggestions[${index}].title`}
                    validators={{
                      onChange: ({ value }) =>
                        value.trim().length === 0 ? t("required") : undefined,
                    }}
                  >
                    {(field) => (
                      <Field
                        error={field.state.meta.errors.join(", ")}
                        label={t("chatStarterLabel")}
                        required
                      >
                        <Input
                          maxLength={80}
                          name={`suggestions-${index}-title`}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.currentTarget.value)
                          }
                          placeholder={t("chatStarterLabelPlaceholder")}
                          value={field.state.value}
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field
                    name={`suggestions[${index}].prompt`}
                    validators={{
                      onChange: ({ value }) =>
                        value.trim().length === 0 ? t("required") : undefined,
                    }}
                  >
                    {(field) => (
                      <Field
                        error={field.state.meta.errors.join(", ")}
                        label={t("chatStarterContent")}
                        required
                      >
                        <Textarea
                          maxLength={4_000}
                          name={`suggestions-${index}-prompt`}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.currentTarget.value)
                          }
                          placeholder={t("chatStarterContentPlaceholder")}
                          rows={4}
                          value={field.state.value}
                        />
                      </Field>
                    )}
                  </form.Field>
                  <Button
                    onClick={() => {
                      suggestionsField.removeValue(index);
                      setOpenPromptIndexes((current) => {
                        const next = new Set<number>();
                        for (const openIndex of current) {
                          if (openIndex < index) next.add(openIndex);
                          if (openIndex > index) next.add(openIndex - 1);
                        }
                        return next;
                      });
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t("remove")}
                  </Button>
                </div>
              </details>
            ))}
          </div>
        )}
      </form.Field>

      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
        })}
      >
        {({ canSubmit, isSubmitting }) => (
          <Button
            disabled={!canSubmit || isSubmitting}
            pending={isSubmitting}
            type="submit"
            variant="primary"
          >
            {isSubmitting ? t("saving") : t("saveConfiguration")}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
