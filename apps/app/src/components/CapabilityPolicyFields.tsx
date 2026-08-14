import { Field, Input, NativeSelect } from "@romeo/ui";

import { useLocale } from "../lib/i18n";
import {
  imageGenerationSizes,
  type CapabilityId,
  type CapabilityPolicyValues,
} from "./capability-admin-policy";

export function CapabilityPolicyFields({
  capabilityId,
  disabled,
  onChange,
  values,
}: {
  capabilityId: CapabilityId;
  disabled: boolean;
  onChange: (values: CapabilityPolicyValues) => void;
  values: CapabilityPolicyValues;
}): React.ReactNode {
  const { t } = useLocale();

  if (
    capabilityId === "voice_processing" ||
    capabilityId === "content_firewall" ||
    capabilityId === "knowledge_acl" ||
    capabilityId === "realtime_voice" ||
    capabilityId === "image_editing" ||
    capabilityId === "secure_compute" ||
    capabilityId === "multi_model_compare" ||
    capabilityId === "tenant_encryption" ||
    capabilityId === "data_export"
  ) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t("capabilityVoiceUsesOrganizationPolicy")}
      </p>
    );
  }

  if (capabilityId === "web_retrieval") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("capabilityMaximumSearchResults")}>
          <Input
            disabled={disabled}
            max={10}
            min={1}
            name="capability_max_search_results"
            onChange={(event) =>
              onChange({
                ...values,
                maxSearchResults: event.currentTarget.valueAsNumber,
              })
            }
            type="number"
            value={values.maxSearchResults}
          />
        </Field>
        <Field label={t("capabilityMaximumUrlsPerRequest")}>
          <Input
            disabled={disabled}
            max={5}
            min={1}
            name="capability_max_urls_per_request"
            onChange={(event) =>
              onChange({
                ...values,
                maxUrlsPerRequest: event.currentTarget.valueAsNumber,
              })
            }
            type="number"
            value={values.maxUrlsPerRequest}
          />
        </Field>
      </div>
    );
  }

  if (capabilityId === "reasoning_policy") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("capabilityReasoningModeMaximum")}>
          <NativeSelect
            disabled={disabled}
            name="capability_reasoning_mode_maximum"
            onChange={(event) =>
              onChange({
                ...values,
                reasoningModeMaximum: event.currentTarget.value as
                  | "off"
                  | "auto"
                  | "summary",
              })
            }
            value={values.reasoningModeMaximum}
          >
            {(
              [
                ["off", "capabilityReasoningModeOff"],
                ["auto", "capabilityReasoningModeAuto"],
                ["summary", "capabilityReasoningModeSummary"],
              ] as const
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("capabilityReasoningEffortMaximum")}>
          <NativeSelect
            disabled={disabled}
            name="capability_reasoning_effort_maximum"
            onChange={(event) =>
              onChange({
                ...values,
                reasoningEffortMaximum: event.currentTarget.value as
                  | "low"
                  | "medium"
                  | "high",
              })
            }
            value={values.reasoningEffortMaximum}
          >
            {(
              [
                ["low", "capabilityReasoningEffortLow"],
                ["medium", "capabilityReasoningEffortMedium"],
                ["high", "capabilityReasoningEffortHigh"],
              ] as const
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("capabilityReasoningTokenMaximum")}>
          <Input
            disabled={disabled}
            max={200000}
            min={1}
            name="capability_reasoning_token_maximum"
            onChange={(event) =>
              onChange({
                ...values,
                maxReasoningTokens: event.currentTarget.valueAsNumber,
              })
            }
            type="number"
            value={values.maxReasoningTokens}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Input
            checked={values.allowReasoningSummaryRetention}
            disabled={disabled}
            name="capability_reasoning_summary_retention"
            onChange={(event) =>
              onChange({
                ...values,
                allowReasoningSummaryRetention: event.currentTarget.checked,
              })
            }
            type="checkbox"
          />
          {t("capabilityReasoningAllowSummaryRetention")}
        </label>
      </div>
    );
  }

  return (
    <>
      <Field label={t("capabilityMaximumImages")}>
        <Input
          disabled={disabled}
          max={4}
          min={1}
          name="capability_max_images_per_request"
          onChange={(event) =>
            onChange({
              ...values,
              maxImagesPerRequest: event.currentTarget.valueAsNumber,
            })
          }
          type="number"
          value={values.maxImagesPerRequest}
        />
      </Field>
      <fieldset disabled={disabled}>
        <legend className="mb-2 text-sm font-medium">
          {t("capabilityAllowedSizes")}
        </legend>
        <div className="flex flex-wrap gap-4">
          {imageGenerationSizes.map((size) => (
            <label className="flex items-center gap-2" key={size}>
              <Input
                checked={values.allowedSizes.includes(size)}
                name={`capability_image_size_${size}`}
                onChange={(event) =>
                  onChange({
                    ...values,
                    allowedSizes: event.currentTarget.checked
                      ? [...values.allowedSizes, size]
                      : values.allowedSizes.filter((item) => item !== size),
                  })
                }
                type="checkbox"
              />
              {size}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
