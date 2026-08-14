import { Section } from "./console";
import { Input, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";

import { updateMyProfileMutationOptions } from "../features/identity/mutation-options";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

export function ProfileEditPanel({
  currentName,
  currentEmail,
}: {
  currentName?: string | undefined;
  currentEmail?: string | undefined;
}) {
  const { t } = useLocale();
  const mutation = useMutation(updateMyProfileMutationOptions());

  const form = useForm({
    defaultValues: { name: currentName ?? "", email: currentEmail ?? "" },
    onSubmit: async ({ value }) => {
      const input: { name?: string; email?: string } = {};
      if (value.name.trim()) input.name = value.name.trim();
      if (value.email.trim()) input.email = value.email.trim();
      if (Object.keys(input).length === 0) {
        toast(t("enterNameOrEmail"), "error");
        return;
      }
      try {
        await mutation.mutateAsync(input);
        toast(t("profileUpdated"), "success");
        form.reset();
      } catch {
        toast(t("couldNotUpdateProfile"), "error");
      }
    },
  });

  return (
    <Section>
      <div className="rm-card-title">{t("profile")}</div>
      <p className="mt-1 text-xs text-muted">{t("profileEditDescription")}</p>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(field) => (
            <label className="grid gap-1 text-sm">
              <span className="text-muted">{t("displayName")}</span>
              <Input
                name="name"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("nameOrEmailPlaceholder")}
                value={field.state.value}
              />
            </label>
          )}
        </form.Field>
        <form.Field
          name="email"
          validators={{
            onChange: ({ value }: { value: string }) =>
              value && !emailPattern.test(value)
                ? t("enterValidEmail")
                : undefined,
          }}
        >
          {(field) => (
            <label className="grid gap-1 text-sm">
              <span className="text-muted">{t("email")}</span>
              <Input
                name="email"
                autoComplete="email"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder="new@email.com"
                type="email"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">
                  {field.state.meta.errors.join(", ")}
                </div>
              ) : null}
            </label>
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
              variant="primary"
              disabled={!canSubmit || isSubmitting || mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? t("saving") : t("saveProfile")}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Section>
  );
}
