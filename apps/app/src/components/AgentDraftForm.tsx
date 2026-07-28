import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useEffect, useMemo } from "react";
import { Button, Field, Input, Select, Textarea } from "@romeo/ui";

import type {
  Agent,
  AgentMemoryPolicy,
  AgentSafetySettings,
} from "../features/managed-models/types";
import type { BaseModel, Provider } from "../features/providers/types";
import { useLocale } from "../lib/i18n";
import { AgentParameterControls } from "./AgentParameterControls";
import {
  applyOptionalParameter,
  buildDefaults,
  buildMemoryPolicy,
  buildModelGroups,
  buildSafetySettings,
  parseBlockedTerms,
  parseBoundedNumber,
  parseOptionalInteger,
  parseOptionalNumber,
} from "./agent-draft-model";

export interface AgentDraftInput {
  agentId: string;
  baseModelId: string;
  systemPrompt: string;
  parameters: Record<string, unknown>;
  memoryPolicy: AgentMemoryPolicy;
  safetySettings: AgentSafetySettings;
}

interface AgentDraftFormProps {
  activeAgent: Agent | undefined;
  isSaving: boolean;
  models: BaseModel[];
  providers: Provider[];
  onNotice: (message: string) => void;
  onSave: (input: AgentDraftInput) => Promise<Agent>;
}

export function AgentDraftForm({
  activeAgent,
  isSaving,
  models,
  providers = [],
  onNotice,
  onSave,
}: AgentDraftFormProps) {
  const { locale, t } = useLocale();
  const promptPresets = [
    { label: t("agentPresetSupport"), prompt: t("agentPresetSupportPrompt") },
    { label: t("agentPresetResearch"), prompt: t("agentPresetResearchPrompt") },
    {
      label: t("agentPresetOperations"),
      prompt: t("agentPresetOperationsPrompt"),
    },
  ];
  const form = useForm({
    defaultValues: buildDefaults(activeAgent),
    onSubmit: async ({ value }) => {
      if (!activeAgent) return;

      const parsedTemperature = parseBoundedNumber(
        value.temperature,
        t("agentTemperature"),
        0,
        2,
        t,
        locale,
      );
      const parsedTopP = parseOptionalNumber(
        value.topP,
        t("agentTopP"),
        0,
        1,
        t,
        locale,
      );
      const parsedMaxOutputTokens = parseOptionalInteger(
        value.maxOutputTokens,
        t("agentMaxOutputTokens"),
        1,
        undefined,
        t,
        locale,
      );
      const parsedMaxMemoryMessages =
        value.memoryMode === "recent_messages"
          ? parseOptionalInteger(
              value.maxMemoryMessages,
              t("agentRecentMessages"),
              1,
              20,
              t,
              locale,
            )
          : {};
      const parsedMaxUserInputLength = parseOptionalInteger(
        value.maxUserInputLength,
        t("agentMaxInputCharacters"),
        1,
        200_000,
        t,
        locale,
      );
      const parsedBlockedTerms = parseBlockedTerms(value.blockedTerms, t);
      const validationError =
        parsedTemperature.error ??
        parsedTopP.error ??
        parsedMaxOutputTokens.error ??
        parsedMaxMemoryMessages.error ??
        parsedMaxUserInputLength.error ??
        parsedBlockedTerms.error;
      if (validationError) {
        onNotice(validationError);
        return;
      }

      const parameters = {
        ...activeAgent.parameters,
        temperature: parsedTemperature.value,
      };
      applyOptionalParameter(parameters, "topP", parsedTopP.value);
      applyOptionalParameter(
        parameters,
        "maxOutputTokens",
        parsedMaxOutputTokens.value,
      );

      try {
        const saved = await onSave({
          agentId: activeAgent.id,
          baseModelId: value.baseModelId,
          systemPrompt: value.systemPrompt,
          parameters,
          memoryPolicy: buildMemoryPolicy(
            value.memoryMode,
            parsedMaxMemoryMessages.value,
          ),
          safetySettings: buildSafetySettings(
            parsedMaxUserInputLength.value,
            parsedBlockedTerms.value ?? [],
          ),
        });
        form.reset(buildDefaults(saved));
        onNotice(t("agentDraftSaved"));
      } catch (caught) {
        onNotice(
          caught instanceof Error ? caught.message : t("agentUnableSaveDraft"),
        );
      }
    },
  });

  const baseModelId = useStore(form.store, (state) => state.values.baseModelId);
  const memoryMode = useStore(form.store, (state) => state.values.memoryMode);

  const modelGroups = useMemo(
    () =>
      buildModelGroups(models, providers, activeAgent?.baseModelId, t, locale),
    [activeAgent?.baseModelId, locale, models, providers, t],
  );
  const selectedModel = useMemo(
    () =>
      modelGroups
        .flatMap((group) => group.models)
        .find((model) => model.id === baseModelId),
    [baseModelId, modelGroups],
  );

  useEffect(() => {
    form.reset(buildDefaults(activeAgent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeAgent?.id,
    activeAgent?.systemPrompt,
    activeAgent?.baseModelId,
    activeAgent?.updatedAt,
  ]);

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="baseModelId">
        {(field) => (
          <Field label={t("agentModel")}>
            <Select
              name="baseModelId"
              disabled={!activeAgent || isSaving || modelGroups.length === 0}
              onValueChange={field.handleChange}
              options={modelGroups.flatMap((group) =>
                group.models.map((model) => ({
                  disabled: !model.enabled,
                  group: group.label,
                  label: model.label,
                  value: model.id,
                })),
              )}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>
      {selectedModel ? (
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          {selectedModel.badges.map((badge) => (
            <span
              className="rounded-md border border-border px-2 py-1"
              key={badge}
            >
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      <form.Field name="systemPrompt">
        {(field) => (
          <Field label={t("agentSystemPrompt")}>
            <Textarea
              name="systemPrompt"
              disabled={!activeAgent || isSaving}
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              rows={5}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>
      <div className="flex flex-wrap gap-2">
        {promptPresets.map((preset) => (
          <Button
            disabled={!activeAgent || isSaving}
            key={preset.label}
            onClick={() => form.setFieldValue("systemPrompt", preset.prompt)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <form.Subscribe
        selector={(state) => ({
          temperature: state.values.temperature,
          topP: state.values.topP,
          maxOutputTokens: state.values.maxOutputTokens,
        })}
      >
        {({ temperature, topP, maxOutputTokens }) => (
          <AgentParameterControls
            disabled={!activeAgent || isSaving}
            maxOutputTokens={maxOutputTokens}
            onMaxOutputTokensChange={(v) =>
              form.setFieldValue("maxOutputTokens", v)
            }
            onTemperatureChange={(v) => form.setFieldValue("temperature", v)}
            onTopPChange={(v) => form.setFieldValue("topP", v)}
            temperature={temperature}
            topP={topP}
          />
        )}
      </form.Subscribe>

      <div className="grid gap-3 rounded-md border border-border p-3">
        <form.Field name="memoryMode">
          {(field) => (
            <Field label={t("agentConversationHistory")}>
              <Select
                name="memoryMode"
                disabled={!activeAgent || isSaving}
                onValueChange={(value) =>
                  field.handleChange(value as AgentMemoryPolicy["mode"])
                }
                options={[
                  { label: t("agentFullHistory"), value: "disabled" },
                  { label: t("agentLimitRecent"), value: "recent_messages" },
                ]}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
        {memoryMode === "recent_messages" ? (
          <form.Field name="maxMemoryMessages">
            {(field) => (
              <Field label={t("agentRecentMessages")}>
                <Input
                  name="maxMemoryMessages"
                  disabled={!activeAgent || isSaving}
                  inputMode="numeric"
                  max={20}
                  min={1}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  type="number"
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
        ) : null}
        <form.Field name="maxUserInputLength">
          {(field) => (
            <Field label={t("agentMaxInputCharacters")}>
              <Input
                name="maxUserInputLength"
                disabled={!activeAgent || isSaving}
                inputMode="numeric"
                min={1}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                type="number"
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="blockedTerms">
          {(field) => (
            <Field label={t("agentBlockedTerms")}>
              <Textarea
                name="blockedTerms"
                disabled={!activeAgent || isSaving}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                rows={3}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
      </div>

      <Button
        disabled={!activeAgent || isSaving || baseModelId.length === 0}
        pending={isSaving}
        type="submit"
        variant="primary"
      >
        {t("agentSaveDraft")}
      </Button>
    </form>
  );
}
