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
import { AdminDisclosure } from "./AdminDisclosure";
import { AgentParameterControls } from "./AgentParameterControls";
import {
  applyOptionalParameter,
  buildDefaults,
  buildMemoryPolicy,
  buildModelGroups,
  buildSafetySettings,
  parseBlockedTerms,
  parseAgentTags,
  parseBoundedNumber,
  parseOptionalInteger,
  parseOptionalNumber,
  parsePromptSuggestions,
} from "./agent-draft-model";
import { shouldResetDraftForm } from "./agent-publish-gate";
import { ManagedModelIdentityFields } from "./ManagedModelIdentityFields";

export interface AgentDraftInput {
  agentId: string;
  name: string;
  description: string;
  icon: string;
  avatarUrl: string;
  baseModelId: string;
  systemPrompt: string;
  parameters: Record<string, unknown>;
  memoryPolicy: AgentMemoryPolicy;
  safetySettings: AgentSafetySettings;
  promptSuggestions: Array<{ title: string; prompt: string }>;
  tags: string[];
}

interface AgentDraftFormProps {
  activeAgent: Agent | undefined;
  formId?: string;
  isSaving: boolean;
  models: BaseModel[];
  providers: Provider[];
  onDirtyChange: (dirty: boolean) => void;
  onNotice: (message: string) => void;
  onSave: (input: AgentDraftInput) => Promise<Agent>;
  showSubmit?: boolean;
}

export function AgentDraftForm({
  activeAgent,
  formId,
  isSaving,
  models,
  providers = [],
  onDirtyChange,
  onNotice,
  onSave,
  showSubmit = true,
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
      const parsedTags = parseAgentTags(value.tags);
      const parsedPromptSuggestions = parsePromptSuggestions(
        value.promptSuggestions,
      );
      const validationError =
        parsedTemperature.error ??
        parsedTopP.error ??
        parsedMaxOutputTokens.error ??
        parsedMaxMemoryMessages.error ??
        parsedMaxUserInputLength.error ??
        parsedBlockedTerms.error ??
        parsedTags.error ??
        parsedPromptSuggestions.error;
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
          name: value.name.trim(),
          description: value.description.trim(),
          icon: value.icon.trim(),
          avatarUrl: value.avatarUrl.trim(),
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
            value.knowledgeGroundingMode === "prefer" ||
              value.knowledgeGroundingMode === "required"
              ? value.knowledgeGroundingMode
              : "optional",
          ),
          promptSuggestions: parsedPromptSuggestions.value ?? [],
          tags: parsedTags.value ?? [],
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
  const isDirty = useStore(form.store, (state) => state.isDirty);
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
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (
      !shouldResetDraftForm({
        isDirty: form.state.isDirty,
        agentChanged: true,
      })
    )
      return;
    form.reset(buildDefaults(activeAgent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgent?.id]);

  useEffect(() => {
    // Re-seeding from the server is correct when the user switches assistants,
    // and destructive when they are mid-edit: publish/rollback both bump
    // updatedAt, which used to fire this reset and wipe the open form.
    if (
      !shouldResetDraftForm({
        isDirty: form.state.isDirty,
        agentChanged: false,
      })
    )
      return;
    form.reset(buildDefaults(activeAgent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeAgent?.systemPrompt,
    activeAgent?.name,
    activeAgent?.description,
    activeAgent?.icon,
    activeAgent?.avatarUrl,
    activeAgent?.baseModelId,
    activeAgent?.promptSuggestions,
    activeAgent?.tags,
    activeAgent?.updatedAt,
  ]);

  return (
    <form
      className="grid gap-3"
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe
        selector={(state) => ({
          avatarUrl: state.values.avatarUrl,
          description: state.values.description,
          icon: state.values.icon,
          name: state.values.name,
        })}
      >
        {(values) => (
          <ManagedModelIdentityFields
            disabled={!activeAgent || isSaving}
            onChange={(field, value) => form.setFieldValue(field, value)}
            values={values}
          />
        )}
      </form.Subscribe>
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
        <ul className="rm-meta-chips">
          {selectedModel.badges.map((badge) => (
            <li className="rm-meta-chip" key={badge}>
              {badge}
            </li>
          ))}
        </ul>
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

      {/* Everything above is the everyday path: who the model is, which base
          model runs it, and what it is told to do. The groups below are tuned
          once and revisited rarely, so they stay collapsed until asked for. */}
      <AdminDisclosure
        description={t("agentGroupDiscoveryHelp")}
        title={t("agentGroupDiscovery")}
      >
        <form.Field name="tags">
          {(field) => (
            <Field label={t("agentTags")}>
              <Input
                disabled={!activeAgent || isSaving}
                name="tags"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("agentTagsPlaceholder")}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="promptSuggestions">
          {(field) => (
            <Field label={t("agentStarterPrompts")}>
              <Textarea
                disabled={!activeAgent || isSaving}
                name="promptSuggestions"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("agentStarterPromptsPlaceholder")}
                rows={4}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
      </AdminDisclosure>

      <AdminDisclosure
        description={t("agentGroupGenerationHelp")}
        title={t("agentGroupGeneration")}
      >
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
      </AdminDisclosure>

      <AdminDisclosure
        description={t("agentGroupGuardrailsHelp")}
        title={t("agentGroupGuardrails")}
      >
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
        <form.Field name="knowledgeGroundingMode">
          {(field) => (
            <Field
              label={t("agentKnowledgeGrounding")}
              description={t("agentKnowledgeGroundingHelp")}
            >
              <Select
                disabled={!activeAgent || isSaving}
                name="knowledgeGroundingMode"
                onValueChange={(value) =>
                  field.handleChange(
                    value as "optional" | "prefer" | "required",
                  )
                }
                options={[
                  {
                    label: t("agentKnowledgeOptional"),
                    value: "optional",
                  },
                  {
                    label: t("agentKnowledgePrefer"),
                    value: "prefer",
                  },
                  {
                    label: t("agentKnowledgeRequired"),
                    value: "required",
                  },
                ]}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
      </AdminDisclosure>

      {showSubmit ? (
        <Button
          disabled={
            !activeAgent ||
            isSaving ||
            baseModelId.length === 0 ||
            form.state.values.name.trim().length === 0
          }
          pending={isSaving}
          type="submit"
          variant="primary"
        >
          {t("agentSaveDraft")}
        </Button>
      ) : null}
    </form>
  );
}
