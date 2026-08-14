import { z } from "zod";

export const platformControlledCapabilityIds = [
  "realtime_voice",
  "external_provider_use",
  "secure_compute",
  "image_generation",
  "image_editing",
  "reasoning_policy",
  "multi_model_compare",
  "streamed_output_policy",
] as const;

export type PlatformControlledCapabilityId =
  (typeof platformControlledCapabilityIds)[number];

const allowedIds = new Set<string>(platformControlledCapabilityIds);
const defaultDisabledCapabilityIds = [
  "realtime_voice",
  "external_provider_use",
  "secure_compute",
  "image_editing",
  "multi_model_compare",
  "streamed_output_policy",
] as const satisfies readonly PlatformControlledCapabilityId[];

export const platformDisabledCapabilityIdsSchema = z
  .string()
  .max(512)
  .default(defaultDisabledCapabilityIds.join(","))
  .superRefine((value, context) => {
    if (value === "") return;
    const ids = value.split(",");
    if (ids.some((id) => id.length === 0 || id !== id.trim())) {
      context.addIssue({
        code: "custom",
        message:
          "CAPABILITY_PLATFORM_DISABLED_IDS must be a comma-separated list without empty entries or whitespace.",
      });
      return;
    }
    if (ids.some((id) => !allowedIds.has(id))) {
      context.addIssue({
        code: "custom",
        message:
          "CAPABILITY_PLATFORM_DISABLED_IDS contains unsupported capability IDs.",
      });
    }
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message:
          "CAPABILITY_PLATFORM_DISABLED_IDS must not contain duplicate capability IDs.",
      });
    }
  })
  .transform((value): PlatformControlledCapabilityId[] =>
    value === "" ? [] : (value.split(",") as PlatformControlledCapabilityId[]),
  );
