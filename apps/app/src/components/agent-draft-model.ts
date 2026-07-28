import type {
  Agent,
  AgentMemoryPolicy,
  AgentSafetySettings,
  BaseModel,
  ModelModality,
  Provider,
  ProviderDeploymentConstraints,
} from "../features/types";
import type { Locale, MessageKey } from "../lib/i18n";
import { formatNumber } from "../lib/locale-format";

interface ModelOption {
  id: string;
  label: string;
  enabled: boolean;
  providerLabel: string;
  providerType: string;
  badges: string[];
}

interface ModelOptionGroup {
  id: string;
  label: string;
  models: ModelOption[];
}

type Translate = (key: MessageKey) => string;

export function buildDefaults(activeAgent: Agent | undefined) {
  return {
    systemPrompt: activeAgent?.systemPrompt ?? "",
    baseModelId: activeAgent?.baseModelId ?? "",
    temperature: readNumberParameter(activeAgent, "temperature", "0.2"),
    topP: readNumberParameter(activeAgent, "topP", ""),
    maxOutputTokens: readNumberParameter(activeAgent, "maxOutputTokens", ""),
    memoryMode: activeAgent?.memoryPolicy.mode ?? "disabled",
    maxMemoryMessages: readMemoryNumber(activeAgent, "maxMessages", "6"),
    maxUserInputLength: readSafetyNumber(activeAgent, "maxUserInputLength", ""),
    blockedTerms: activeAgent?.safetySettings.blockedTerms?.join("\n") ?? "",
  };
}

export function buildModelGroups(
  models: BaseModel[],
  providers: Provider[],
  activeBaseModelId: string | undefined,
  t: Translate,
  locale: Locale,
): ModelOptionGroup[] {
  const providerById = new Map(
    providers.map((provider) => [provider.id, provider]),
  );
  const groups = new Map<string, ModelOptionGroup>();

  for (const model of models) {
    const provider = providerById.get(model.providerId);
    const providerLabel = provider?.name ?? model.providerId;
    const providerType = provider?.type ?? "custom";
    const providerEnabled = provider?.enabled ?? true;
    const groupId = provider?.id ?? model.providerId;
    const group = groups.get(groupId) ?? {
      id: groupId,
      label: `${providerLabel} - ${providerType}${providerEnabled ? "" : ` - ${t("agentDisabled")}`}`,
      models: [],
    };
    group.models.push({
      id: model.id,
      label: `${model.displayName}${model.enabled && providerEnabled ? "" : ` - ${t("agentDisabled")}`}`,
      enabled: model.enabled && providerEnabled,
      providerLabel,
      providerType,
      badges: modelCapabilityBadges(
        model,
        providerLabel,
        providerType,
        providerEnabled,
        t,
        locale,
      ),
    });
    groups.set(groupId, group);
  }

  if (
    activeBaseModelId &&
    !models.some((model) => model.id === activeBaseModelId)
  ) {
    groups.set("current-model", {
      id: "current-model",
      label: t("agentCurrentDraftUnavailable"),
      models: [
        {
          id: activeBaseModelId,
          label: activeBaseModelId,
          enabled: true,
          providerLabel: t("agentUnknownProvider"),
          providerType: "unavailable",
          badges: [t("agentUnknownProvider"), t("agentUnavailableMetadata")],
        },
      ],
    });
  }

  return Array.from(groups.values());
}

function modelCapabilityBadges(
  model: BaseModel,
  providerLabel: string,
  providerType: string,
  providerEnabled: boolean,
  t: Translate,
  locale: Locale,
): string[] {
  const capabilities = model.capabilities;
  const deployment = capabilities?.deployment;
  return [
    providerLabel,
    providerType,
    providerEnabled && model.enabled
      ? t("agentEnabled")
      : t("agentDisabledBadge"),
    formatContextWindow(model.contextWindow, t, locale),
    formatModalities(capabilities?.modalities, t),
    capabilities?.toolCalling === true ? t("agentTools") : t("agentNoTools"),
    capabilities?.structuredJson === true
      ? t("agentJson")
      : t("agentPlainText"),
    deploymentModeLabel(deployment, t),
    networkAccessLabel(deployment, t),
    credentialLabel(deployment, t),
    model.pricing !== undefined
      ? t("agentPricingConfigured")
      : t("agentPricingUnset"),
  ];
}

function formatContextWindow(
  contextWindow: number,
  t: Translate,
  locale: Locale,
): string {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0)
    return t("agentContextUnknown");
  if (contextWindow >= 1000)
    return `${formatNumber(Math.round(contextWindow / 1000), locale)}k ${t("agentContext")}`;
  return `${formatNumber(contextWindow, locale)} ${t("agentContext")}`;
}

function formatModalities(
  modalities: ModelModality[] | undefined,
  t: Translate,
): string {
  if (modalities === undefined || modalities.length === 0)
    return t("agentModalityUnknown");
  return modalities.map((modality) => modalityLabel(modality, t)).join(" + ");
}

function modalityLabel(modality: ModelModality, t: Translate): string {
  if (modality === "audio-input") return t("agentAudioIn");
  if (modality === "audio-output") return t("agentAudioOut");
  if (modality === "embeddings") return t("agentEmbeddings");
  if (modality === "vision") return t("agentVision");
  return t("agentText");
}

function deploymentModeLabel(
  deployment: ProviderDeploymentConstraints | undefined,
  t: Translate,
): string {
  if (deployment === undefined) return t("agentDeploymentUnknown");
  return deployment.mode === "local-runtime"
    ? t("agentLocalRuntime")
    : t("agentHostedApi");
}

function networkAccessLabel(
  deployment: ProviderDeploymentConstraints | undefined,
  t: Translate,
): string {
  if (deployment === undefined) return t("agentNetworkUnknown");
  return deployment.networkAccess === "local-http"
    ? t("agentLocalHttp")
    : t("agentExternalHttp");
}

function credentialLabel(
  deployment: ProviderDeploymentConstraints | undefined,
  t: Translate,
): string {
  if (deployment === undefined) return t("agentCredentialUnknown");
  return deployment.credentialRequired ? t("agentApiKey") : t("agentNoKey");
}

function readNumberParameter(
  agent: Agent | undefined,
  key: string,
  fallback: string,
): string {
  const value = agent?.parameters[key];
  return typeof value === "number" ? String(value) : fallback;
}

export function parseBoundedNumber(
  value: string,
  label: string,
  min: number,
  max: number,
  t: Translate,
  locale: Locale,
): { value?: number; error?: string } {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return {
      error: `${label} ${t("agentMustBeBetween")} ${formatNumber(min, locale)} ${t("agentAnd")} ${formatNumber(max, locale)}.`,
    };
  }
  return { value: parsed };
}

export function parseOptionalNumber(
  value: string,
  label: string,
  min: number,
  max: number,
  t: Translate,
  locale: Locale,
): { value?: number; error?: string } {
  if (value.trim().length === 0) return {};
  return parseBoundedNumber(value, label, min, max, t, locale);
}

export function parseOptionalInteger(
  value: string,
  label: string,
  min: number,
  max: number | undefined,
  t: Translate,
  locale: Locale,
): { value?: number; error?: string } {
  if (value.trim().length === 0) return {};
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min)
    return {
      error: `${label} ${t("agentMustBeAtLeast")} ${formatNumber(min, locale)}.`,
    };
  if (max !== undefined && parsed > max)
    return {
      error: `${label} ${t("agentMustBeAtMost")} ${formatNumber(max, locale)}.`,
    };
  return { value: parsed };
}

export function parseBlockedTerms(
  value: string,
  t: Translate,
): { value?: string[]; error?: string } {
  const terms = value
    .split("\n")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  if (terms.length > 100) return { error: t("agentBlockedTermsMaxEntries") };
  if (terms.some((term) => term.length > 120))
    return { error: t("agentBlockedTermMaxLength") };
  return { value: terms };
}

export function buildSafetySettings(
  maxUserInputLength: number | undefined,
  blockedTerms: string[],
): AgentSafetySettings {
  const safetySettings: AgentSafetySettings = {};
  if (maxUserInputLength !== undefined)
    safetySettings.maxUserInputLength = maxUserInputLength;
  if (blockedTerms.length > 0) safetySettings.blockedTerms = blockedTerms;
  return safetySettings;
}

export function buildMemoryPolicy(
  mode: AgentMemoryPolicy["mode"],
  maxMessages: number | undefined,
): AgentMemoryPolicy {
  if (mode === "disabled") return { mode: "disabled" };
  const policy: AgentMemoryPolicy = { mode: "recent_messages" };
  if (maxMessages !== undefined) policy.maxMessages = maxMessages;
  return policy;
}

export function applyOptionalParameter(
  parameters: Record<string, unknown>,
  key: string,
  value: number | undefined,
) {
  if (value === undefined) {
    delete parameters[key];
    return;
  }
  parameters[key] = value;
}

function readSafetyNumber(
  agent: Agent | undefined,
  key: keyof AgentSafetySettings,
  fallback: string,
): string {
  const value = agent?.safetySettings[key];
  return typeof value === "number" ? String(value) : fallback;
}

function readMemoryNumber(
  agent: Agent | undefined,
  key: "maxMessages",
  fallback: string,
): string {
  const policy = agent?.memoryPolicy;
  const value = policy?.mode === "recent_messages" ? policy[key] : undefined;
  return typeof value === "number" ? String(value) : fallback;
}
