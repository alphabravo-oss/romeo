import { Section } from "./console";
import { Button, EmptyState, Field, Input, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";

import type { ChatExperience } from "../features/chat-experience";
import { updateChatExperienceMutationOptions } from "../features/chat-experience/mutation-options";
import { chatExperienceQueryOptions } from "../features/chat-experience/query-options";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { safeUserErrorMessage } from "../lib/safe-user-error";

export function ChatExperiencePanel() {
  const query = useQuery(chatExperienceQueryOptions());
  const { t } = useLocale();

  return (
    <Section
      description={t("chatExperienceSettingsDescription")}
      title={t("chatExperienceSettings")}
    >
      <PanelState query={query} isEmpty={() => false}>
        {(settings) => (
          <ChatExperienceForm
            initial={settings}
            key={JSON.stringify(settings)}
          />
        )}
      </PanelState>
    </Section>
  );
}

function ChatExperienceForm({ initial }: { initial: ChatExperience }) {
  const { t } = useLocale();
  const mutation = useMutation(updateChatExperienceMutationOptions());
  const form = useForm({
    defaultValues: { ...initial, assistantsEnabled: true },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync({ ...value, assistantsEnabled: true });
        toast(t("chatExperienceSaved"), "success");
      } catch (caught) {
        toast(
          safeUserErrorMessage(caught, t("chatExperienceSaveFailed")),
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
      {/* assistantsEnabled is always on server-side; dual bare/assistant mode removed. */}

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
                onClick={() =>
                  suggestionsField.pushValue({ title: "", prompt: "" })
                }
                type="button"
              >
                {t("chatAddStarter")}
              </Button>
            </div>

            {suggestionsField.state.value.length === 0 ? (
              <EmptyState title={t("chatNoStarters")} />
            ) : null}

            {suggestionsField.state.value.map((_, index) => (
              <div className="rm-starter-prompt" key={index}>
                <div className="rm-starter-prompt__header">
                  <span className="rm-starter-prompt__index">
                    {t("chatStarterPrompt")} {index + 1}
                  </span>
                  <Button
                    onClick={() => suggestionsField.removeValue(index)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t("remove")}
                  </Button>
                </div>
                <div className="rm-starter-prompt__body">
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
                          rows={3}
                          value={field.state.value}
                        />
                      </Field>
                    )}
                  </form.Field>
                </div>
              </div>
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
