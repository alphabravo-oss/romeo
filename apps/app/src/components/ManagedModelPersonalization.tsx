import { Input, Textarea, NativeSelect, Button } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import { useEffect, useState } from "react";

import { listVoices } from "../features";
import {
  clearManagedModelPreferences,
  getManagedModelCustomizationPolicy,
  getManagedModelPreferences,
  updateManagedModelPreferences,
} from "../features/managed-models";
import type { ManagedModelPreferences } from "../features/managed-models";
import { useLocale, type MessageKey } from "../lib/i18n";
import { toast } from "../lib/toast";
import { FormDialog } from "./FormDialog";

export function ManagedModelPersonalization({
  agentId,
}: {
  agentId: string | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ManagedModelPreferences>({});
  const policyQuery = useQuery({
    queryKey: ["managedModelCustomizationPolicy", agentId],
    queryFn: () => getManagedModelCustomizationPolicy(agentId!),
    enabled: agentId !== undefined,
  });
  const preferencesQuery = useQuery({
    queryKey: ["managedModelPreferences", agentId],
    queryFn: () => getManagedModelPreferences(agentId!),
    enabled: agentId !== undefined && policyQuery.data !== undefined,
  });
  const voicesQuery = useQuery({
    queryKey: ["voices"],
    queryFn: listVoices,
    enabled: policyQuery.data?.allowVoiceSelection === true,
  });
  const saveMutation = useMutation({
    mutationFn: updateManagedModelPreferences,
  });
  const clearMutation = useMutation({
    mutationFn: clearManagedModelPreferences,
  });
  const policy = policyQuery.data;
  const enabled = policy ? Object.values(policy).some(Boolean) : false;

  useEffect(() => {
    setDraft(preferencesQuery.data ?? {});
  }, [agentId, preferencesQuery.data]);

  if (!agentId || !enabled || !policy) return null;

  async function save() {
    if (!agentId) return;
    try {
      const preferences = await saveMutation.mutateAsync({
        agentId,
        preferences: draft,
      });
      queryClient.setQueryData(
        ["managedModelPreferences", agentId],
        preferences,
      );
      setOpen(false);
      toast(t("managedModelPreferencesSaved"), "success");
    } catch {
      toast(t("failed"), "error");
    }
  }

  async function reset() {
    if (!agentId) return;
    try {
      const preferences = await clearMutation.mutateAsync(agentId);
      queryClient.setQueryData(
        ["managedModelPreferences", agentId],
        preferences,
      );
      setDraft(preferences);
      setOpen(false);
      toast(t("managedModelPreferencesReset"), "success");
    } catch {
      toast(t("failed"), "error");
    }
  }

  return (
    <>
      <Button
        aria-label={t("managedModelPersonalize")}
        className="rm-topbar-button rm-personalize-trigger"
        onClick={() => setOpen(true)}
        title={t("managedModelPersonalize")}
        type="button"
      >
        <SlidersHorizontal aria-hidden="true" size={14} />
        <span>{t("managedModelPersonalize")}</span>
      </Button>
      {open ? (
        <FormDialog
          description={t("managedModelPersonalizeDescription")}
          onClose={() => setOpen(false)}
          open={open}
          title={t("managedModelPersonalize")}
        >
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {policy.allowCommunicationStyle ? (
              <PreferenceSelect
                label={t("managedModelAllowTone")}
                onChange={(communicationStyle) =>
                  setDraft((current) => ({
                    ...current,
                    communicationStyle: communicationStyle as NonNullable<
                      ManagedModelPreferences["communicationStyle"]
                    >,
                  }))
                }
                options={[
                  "balanced",
                  "concise",
                  "detailed",
                  "formal",
                  "friendly",
                ]}
                value={draft.communicationStyle ?? "balanced"}
              />
            ) : null}
            {policy.allowResponseLength ? (
              <PreferenceSelect
                label={t("managedModelAllowLength")}
                onChange={(responseLength) =>
                  setDraft((current) => ({
                    ...current,
                    responseLength: responseLength as NonNullable<
                      ManagedModelPreferences["responseLength"]
                    >,
                  }))
                }
                options={["short", "standard", "long"]}
                value={draft.responseLength ?? "standard"}
              />
            ) : null}
            {policy.allowLanguage ? (
              <label className="grid gap-1 text-sm">
                <span className="text-muted">
                  {t("managedModelAllowLanguage")}
                </span>
                <Input
                  name="draft"
                  maxLength={40}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      language: event.currentTarget.value,
                    }))
                  }
                  value={draft.language ?? ""}
                />
              </label>
            ) : null}
            {policy.allowCustomInstructions ? (
              <label className="grid gap-1 text-sm">
                <span className="text-muted">
                  {t("managedModelAllowInstructions")}
                </span>
                <Textarea
                  name="draft"
                  className="rm-textarea"
                  maxLength={2_000}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      customInstructions: event.currentTarget.value,
                    }))
                  }
                  rows={4}
                  value={draft.customInstructions ?? ""}
                />
              </label>
            ) : null}
            {policy.allowPersonalMemory ? (
              <label className="flex items-center gap-2 text-sm">
                <Input
                  name="draft"
                  checked={draft.personalMemoryEnabled === true}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      personalMemoryEnabled: event.currentTarget.checked,
                    }))
                  }
                  type="checkbox"
                />
                <span>{t("managedModelAllowMemory")}</span>
              </label>
            ) : null}
            {policy.allowVoiceSelection ? (
              <label className="grid gap-1 text-sm">
                <span className="text-muted">
                  {t("managedModelAllowVoice")}
                </span>
                <NativeSelect
                  name="draft"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      voiceProfileId: event.currentTarget.value,
                    }))
                  }
                  value={draft.voiceProfileId ?? ""}
                >
                  <option value="">{t("assistantDefault")}</option>
                  {(voicesQuery.data ?? []).map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                disabled={clearMutation.isPending}
                onClick={() => void reset()}
                type="button"
              >
                {t("reset")}
              </Button>
              <Button
                variant="primary"
                disabled={saveMutation.isPending}
                type="submit"
              >
                {t("save")}
              </Button>
            </div>
          </form>
        </FormDialog>
      ) : null}
    </>
  );
}

type PreferenceOption =
  | NonNullable<ManagedModelPreferences["communicationStyle"]>
  | NonNullable<ManagedModelPreferences["responseLength"]>;

function PreferenceSelect<T extends PreferenceOption>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: readonly T[];
  value: T;
}) {
  const { t } = useLocale();
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <NativeSelect
        name="preference"
        onChange={(event) => onChange(event.currentTarget.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {t(preferenceOptionKey(option))}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

function preferenceOptionKey(option: PreferenceOption): MessageKey {
  switch (option) {
    case "balanced":
      return "preferenceBalanced";
    case "concise":
      return "preferenceConcise";
    case "detailed":
      return "preferenceDetailed";
    case "formal":
      return "preferenceFormal";
    case "friendly":
      return "preferenceFriendly";
    case "long":
      return "preferenceLong";
    case "short":
      return "preferenceShort";
    case "standard":
      return "preferenceStandard";
  }
}
