import { Field, Input, Textarea } from "@romeo/ui";

import { useLocale } from "../lib/i18n";
import { ManagedModelAvatar } from "./ManagedModelAvatar";

export interface ManagedModelIdentityValues {
  avatarUrl: string;
  description: string;
  icon: string;
  name: string;
}

export function ManagedModelIdentityFields({
  disabled,
  onChange,
  values,
}: {
  disabled: boolean;
  onChange: (field: keyof ManagedModelIdentityValues, value: string) => void;
  values: ManagedModelIdentityValues;
}) {
  const { t } = useLocale();

  return (
    <div className="rm-managed-model-identity-form">
      <ManagedModelAvatar
        agent={values}
        className="rm-managed-model-identity-form__avatar"
        size={72}
      />
      <div className="grid min-w-0 gap-3">
        <Field label={t("agentName")} required>
          <Input
            autoComplete="off"
            disabled={disabled}
            maxLength={200}
            name="managedModelName"
            onChange={(event) => onChange("name", event.currentTarget.value)}
            value={values.name}
          />
        </Field>
        <Field
          description={t("managedModelDescriptionHelp")}
          label={t("managedModelDescription")}
        >
          <Textarea
            disabled={disabled}
            maxLength={1_000}
            name="managedModelDescription"
            onChange={(event) =>
              onChange("description", event.currentTarget.value)
            }
            rows={3}
            value={values.description}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Field
            description={t("managedModelIconHelp")}
            label={t("managedModelIcon")}
          >
            <Input
              autoComplete="off"
              disabled={disabled}
              maxLength={16}
              name="managedModelIcon"
              onChange={(event) => onChange("icon", event.currentTarget.value)}
              placeholder="🤖"
              value={values.icon}
            />
          </Field>
          <Field
            description={t("managedModelPhotoHelp")}
            label={t("managedModelPhoto")}
          >
            <Input
              autoComplete="off"
              disabled={disabled}
              maxLength={2_000}
              name="managedModelPhoto"
              onChange={(event) =>
                onChange("avatarUrl", event.currentTarget.value)
              }
              placeholder="https://…"
              type="url"
              value={values.avatarUrl}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
