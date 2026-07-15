import { useForm } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo } from 'react'

import type { Agent, AgentMemoryPolicy, AgentSafetySettings, BaseModel, ModelModality, Provider, ProviderDeploymentConstraints } from '../api/types'
import { AgentParameterControls } from './AgentParameterControls'

export interface AgentDraftInput {
  agentId: string
  baseModelId: string
  systemPrompt: string
  parameters: Record<string, unknown>
  memoryPolicy: AgentMemoryPolicy
  safetySettings: AgentSafetySettings
}

interface AgentDraftFormProps {
  activeAgent: Agent | undefined
  isSaving: boolean
  models: BaseModel[]
  providers: Provider[]
  onNotice: (message: string) => void
  onSave: (input: AgentDraftInput) => Promise<Agent>
}

interface ModelOption {
  id: string
  label: string
  enabled: boolean
  providerLabel: string
  providerType: string
  badges: string[]
}

interface ModelOptionGroup {
  id: string
  label: string
  models: ModelOption[]
}

const promptPresets = [
  { label: 'Support', prompt: 'You are Romeo, a precise support agent. Ask one clarifying question only when needed, then give direct next steps.' },
  { label: 'Research', prompt: 'You are Romeo, a research assistant. Separate verified facts from assumptions and cite source context when available.' },
  { label: 'Operations', prompt: 'You are Romeo, an operations copilot. Prioritize runbooks, risks, owners, and concrete handoff steps.' }
]

export function AgentDraftForm({ activeAgent, isSaving, models, providers = [], onNotice, onSave }: AgentDraftFormProps) {
  const form = useForm({
    defaultValues: buildDefaults(activeAgent),
    onSubmit: async ({ value }) => {
      if (!activeAgent) return

      const parsedTemperature = parseBoundedNumber(value.temperature, 'Temperature', 0, 2)
      const parsedTopP = parseOptionalNumber(value.topP, 'Top P', 0, 1)
      const parsedMaxOutputTokens = parseOptionalInteger(value.maxOutputTokens, 'Max output tokens', 1)
      const parsedMaxMemoryMessages = value.memoryMode === 'recent_messages' ? parseOptionalInteger(value.maxMemoryMessages, 'Recent messages', 1, 20) : {}
      const parsedMaxUserInputLength = parseOptionalInteger(value.maxUserInputLength, 'Max input characters', 1, 200_000)
      const parsedBlockedTerms = parseBlockedTerms(value.blockedTerms)
      const validationError =
        parsedTemperature.error ??
        parsedTopP.error ??
        parsedMaxOutputTokens.error ??
        parsedMaxMemoryMessages.error ??
        parsedMaxUserInputLength.error ??
        parsedBlockedTerms.error
      if (validationError) {
        onNotice(validationError)
        return
      }

      const parameters = { ...activeAgent.parameters, temperature: parsedTemperature.value }
      applyOptionalParameter(parameters, 'topP', parsedTopP.value)
      applyOptionalParameter(parameters, 'maxOutputTokens', parsedMaxOutputTokens.value)

      try {
        const saved = await onSave({
          agentId: activeAgent.id,
          baseModelId: value.baseModelId,
          systemPrompt: value.systemPrompt,
          parameters,
          memoryPolicy: buildMemoryPolicy(value.memoryMode, parsedMaxMemoryMessages.value),
          safetySettings: buildSafetySettings(parsedMaxUserInputLength.value, parsedBlockedTerms.value ?? [])
        })
        form.reset(buildDefaults(saved))
        onNotice('Draft saved.')
      } catch (caught) {
        onNotice(caught instanceof Error ? caught.message : 'Unable to save draft.')
      }
    }
  })

  const baseModelId = useStore(form.store, (state) => state.values.baseModelId)
  const memoryMode = useStore(form.store, (state) => state.values.memoryMode)

  const modelGroups = useMemo(() => buildModelGroups(models, providers, activeAgent?.baseModelId), [activeAgent?.baseModelId, models, providers])
  const selectedModel = useMemo(
    () => modelGroups.flatMap((group) => group.models).find((model) => model.id === baseModelId),
    [baseModelId, modelGroups]
  )

  useEffect(() => {
    form.reset(buildDefaults(activeAgent))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgent?.id, activeAgent?.systemPrompt, activeAgent?.baseModelId, activeAgent?.updatedAt])

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <label className="text-sm text-muted" htmlFor="agent-base-model">
        Model
      </label>
      <form.Field name="baseModelId">
        {(field) => (
          <select
            className="rm-input"
            disabled={!activeAgent || isSaving || modelGroups.length === 0}
            id="agent-base-model"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.currentTarget.value)}
            value={field.state.value}
          >
            {modelGroups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.models.map((model) => (
                  <option disabled={!model.enabled} key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </form.Field>
      {selectedModel ? (
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          {selectedModel.badges.map((badge) => (
            <span className="rounded-md border border-border px-2 py-1" key={badge}>
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      <label className="text-sm text-muted" htmlFor="agent-system-prompt">
        System prompt
      </label>
      <form.Field name="systemPrompt">
        {(field) => (
          <textarea
            className="rm-textarea"
            disabled={!activeAgent || isSaving}
            id="agent-system-prompt"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.currentTarget.value)}
            rows={5}
            value={field.state.value}
          />
        )}
      </form.Field>
      <div className="flex flex-wrap gap-2">
        {promptPresets.map((preset) => (
          <button className="rm-button" disabled={!activeAgent || isSaving} key={preset.label} onClick={() => form.setFieldValue('systemPrompt', preset.prompt)} type="button">
            {preset.label}
          </button>
        ))}
      </div>

      <form.Subscribe
        selector={(state) => ({
          temperature: state.values.temperature,
          topP: state.values.topP,
          maxOutputTokens: state.values.maxOutputTokens
        })}
      >
        {({ temperature, topP, maxOutputTokens }) => (
          <AgentParameterControls
            disabled={!activeAgent || isSaving}
            maxOutputTokens={maxOutputTokens}
            onMaxOutputTokensChange={(v) => form.setFieldValue('maxOutputTokens', v)}
            onTemperatureChange={(v) => form.setFieldValue('temperature', v)}
            onTopPChange={(v) => form.setFieldValue('topP', v)}
            temperature={temperature}
            topP={topP}
          />
        )}
      </form.Subscribe>

      <div className="grid gap-3 rounded-md border border-border p-3">
        <label className="text-sm text-muted" htmlFor="agent-memory-mode">
          Conversation history
        </label>
        <form.Field name="memoryMode">
          {(field) => (
            <select
              className="rm-input"
              disabled={!activeAgent || isSaving}
              id="agent-memory-mode"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as AgentMemoryPolicy['mode'])}
              value={field.state.value}
            >
              <option value="disabled">Full history (default)</option>
              <option value="recent_messages">Limit to recent messages</option>
            </select>
          )}
        </form.Field>
        {memoryMode === 'recent_messages' ? (
          <>
            <label className="text-sm text-muted" htmlFor="agent-memory-count">
              Recent messages
            </label>
            <form.Field name="maxMemoryMessages">
              {(field) => (
                <input
                  className="rm-input"
                  disabled={!activeAgent || isSaving}
                  id="agent-memory-count"
                  inputMode="numeric"
                  max={20}
                  min={1}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  type="number"
                  value={field.state.value}
                />
              )}
            </form.Field>
          </>
        ) : null}
        <label className="text-sm text-muted" htmlFor="agent-max-input">
          Max input characters
        </label>
        <form.Field name="maxUserInputLength">
          {(field) => (
            <input
              className="rm-input"
              disabled={!activeAgent || isSaving}
              id="agent-max-input"
              inputMode="numeric"
              min={1}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              type="number"
              value={field.state.value}
            />
          )}
        </form.Field>
        <label className="text-sm text-muted" htmlFor="agent-blocked-terms">
          Blocked terms
        </label>
        <form.Field name="blockedTerms">
          {(field) => (
            <textarea
              className="rm-textarea"
              disabled={!activeAgent || isSaving}
              id="agent-blocked-terms"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              rows={3}
              value={field.state.value}
            />
          )}
        </form.Field>
      </div>

      <button className="rm-button" disabled={!activeAgent || isSaving || baseModelId.length === 0} type="submit">
        {isSaving ? 'Saving' : 'Save draft'}
      </button>
    </form>
  )
}

function buildDefaults(activeAgent: Agent | undefined) {
  return {
    systemPrompt: activeAgent?.systemPrompt ?? '',
    baseModelId: activeAgent?.baseModelId ?? '',
    temperature: readNumberParameter(activeAgent, 'temperature', '0.2'),
    topP: readNumberParameter(activeAgent, 'topP', ''),
    maxOutputTokens: readNumberParameter(activeAgent, 'maxOutputTokens', ''),
    memoryMode: activeAgent?.memoryPolicy.mode ?? 'disabled',
    maxMemoryMessages: readMemoryNumber(activeAgent, 'maxMessages', '6'),
    maxUserInputLength: readSafetyNumber(activeAgent, 'maxUserInputLength', ''),
    blockedTerms: activeAgent?.safetySettings.blockedTerms?.join('\n') ?? ''
  }
}

function buildModelGroups(models: BaseModel[], providers: Provider[], activeBaseModelId: string | undefined): ModelOptionGroup[] {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const groups = new Map<string, ModelOptionGroup>()

  for (const model of models) {
    const provider = providerById.get(model.providerId)
    const providerLabel = provider?.name ?? model.providerId
    const providerType = provider?.type ?? 'custom'
    const providerEnabled = provider?.enabled ?? true
    const groupId = provider?.id ?? model.providerId
    const group = groups.get(groupId) ?? {
      id: groupId,
      label: `${providerLabel} - ${providerType}${providerEnabled ? '' : ' - disabled'}`,
      models: []
    }
    group.models.push({
      id: model.id,
      label: `${model.displayName}${model.enabled && providerEnabled ? '' : ' - disabled'}`,
      enabled: model.enabled && providerEnabled,
      providerLabel,
      providerType,
      badges: modelCapabilityBadges(model, providerLabel, providerType, providerEnabled)
    })
    groups.set(groupId, group)
  }

  if (activeBaseModelId && !models.some((model) => model.id === activeBaseModelId)) {
    groups.set('current-model', {
      id: 'current-model',
      label: 'Current draft - unavailable',
      models: [
        {
          id: activeBaseModelId,
          label: activeBaseModelId,
          enabled: true,
          providerLabel: 'Unknown provider',
          providerType: 'unavailable',
          badges: ['Unknown provider', 'Unavailable metadata']
        }
      ]
    })
  }

  return Array.from(groups.values())
}

function modelCapabilityBadges(model: BaseModel, providerLabel: string, providerType: string, providerEnabled: boolean): string[] {
  const capabilities = model.capabilities
  const deployment = capabilities?.deployment
  return [
    providerLabel,
    providerType,
    providerEnabled && model.enabled ? 'Enabled' : 'Disabled',
    formatContextWindow(model.contextWindow),
    formatModalities(capabilities?.modalities),
    capabilities?.toolCalling === true ? 'Tools' : 'No tools',
    capabilities?.structuredJson === true ? 'JSON' : 'Plain text',
    deploymentModeLabel(deployment),
    networkAccessLabel(deployment),
    credentialLabel(deployment),
    model.pricing !== undefined ? 'Pricing configured' : 'Pricing unset'
  ]
}

function formatContextWindow(contextWindow: number): string {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 'Context unknown'
  if (contextWindow >= 1000) return `${Math.round(contextWindow / 1000)}k context`
  return `${contextWindow} context`
}

function formatModalities(modalities: ModelModality[] | undefined): string {
  if (modalities === undefined || modalities.length === 0) return 'Modality unknown'
  return modalities.map((modality) => modalityLabel(modality)).join(' + ')
}

function modalityLabel(modality: ModelModality): string {
  if (modality === 'audio-input') return 'Audio in'
  if (modality === 'audio-output') return 'Audio out'
  if (modality === 'embeddings') return 'Embeddings'
  if (modality === 'vision') return 'Vision'
  return 'Text'
}

function deploymentModeLabel(deployment: ProviderDeploymentConstraints | undefined): string {
  if (deployment === undefined) return 'Deployment unknown'
  return deployment.mode === 'local-runtime' ? 'Local runtime' : 'Hosted API'
}

function networkAccessLabel(deployment: ProviderDeploymentConstraints | undefined): string {
  if (deployment === undefined) return 'Network unknown'
  return deployment.networkAccess === 'local-http' ? 'Local HTTP' : 'External HTTP'
}

function credentialLabel(deployment: ProviderDeploymentConstraints | undefined): string {
  if (deployment === undefined) return 'Credential unknown'
  return deployment.credentialRequired ? 'API key' : 'No key'
}

function readNumberParameter(agent: Agent | undefined, key: string, fallback: string): string {
  const value = agent?.parameters[key]
  return typeof value === 'number' ? String(value) : fallback
}

function parseBoundedNumber(value: string, label: string, min: number, max: number): { value?: number; error?: string } {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return { error: `${label} must be between ${min} and ${max}.` }
  return { value: parsed }
}

function parseOptionalNumber(value: string, label: string, min: number, max: number): { value?: number; error?: string } {
  if (value.trim().length === 0) return {}
  return parseBoundedNumber(value, label, min, max)
}

function parseOptionalInteger(value: string, label: string, min: number, max?: number): { value?: number; error?: string } {
  if (value.trim().length === 0) return {}
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min) return { error: `${label} must be ${min} or greater.` }
  if (max !== undefined && parsed > max) return { error: `${label} must be ${max} or fewer.` }
  return { value: parsed }
}

function parseBlockedTerms(value: string): { value?: string[]; error?: string } {
  const terms = value
    .split('\n')
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
  if (terms.length > 100) return { error: 'Blocked terms supports at most 100 entries.' }
  if (terms.some((term) => term.length > 120)) return { error: 'Blocked terms must be 120 characters or fewer.' }
  return { value: terms }
}

function buildSafetySettings(maxUserInputLength: number | undefined, blockedTerms: string[]): AgentSafetySettings {
  const safetySettings: AgentSafetySettings = {}
  if (maxUserInputLength !== undefined) safetySettings.maxUserInputLength = maxUserInputLength
  if (blockedTerms.length > 0) safetySettings.blockedTerms = blockedTerms
  return safetySettings
}

function buildMemoryPolicy(mode: AgentMemoryPolicy['mode'], maxMessages: number | undefined): AgentMemoryPolicy {
  if (mode === 'disabled') return { mode: 'disabled' }
  const policy: AgentMemoryPolicy = { mode: 'recent_messages' }
  if (maxMessages !== undefined) policy.maxMessages = maxMessages
  return policy
}

function applyOptionalParameter(parameters: Record<string, unknown>, key: string, value: number | undefined) {
  if (value === undefined) {
    delete parameters[key]
    return
  }
  parameters[key] = value
}

function readSafetyNumber(agent: Agent | undefined, key: keyof AgentSafetySettings, fallback: string): string {
  const value = agent?.safetySettings[key]
  return typeof value === 'number' ? String(value) : fallback
}

function readMemoryNumber(agent: Agent | undefined, key: keyof AgentMemoryPolicy, fallback: string): string {
  const value = agent?.memoryPolicy[key]
  return typeof value === 'number' ? String(value) : fallback
}
