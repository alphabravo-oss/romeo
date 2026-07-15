import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getSsoSettings, testSsoSettings, updateSsoSettings } from '../api/client'
import type { SsoOidcProviderPresetId } from '../api/admin-types'
import { toast } from '../lib/toast'

export function SsoSettingsPanel() {
  const queryClient = useQueryClient()
  const ssoQuery = useQuery({ queryKey: ['sso-settings'], queryFn: getSsoSettings })
  const testMutation = useMutation({ mutationFn: testSsoSettings })
  const updateMutation = useMutation({
    mutationFn: updateSsoSettings,
    onSuccess: (report) => {
      queryClient.setQueryData(['sso-settings'], report)
    }
  })
  const settings = ssoQuery.data
  const test = testMutation.data

  const form = useForm({
    defaultValues: {
      enabled: false,
      issuerUrl: '',
      clientId: '',
      providerPreset: 'generic' as SsoOidcProviderPresetId,
      groupClaim: 'groups',
      adminGroups: '',
      groupMap: '',
      workspaceGroupMap: '',
      workspaceGroupPrefix: ''
    },
    onSubmit: async ({ value }) => {
      try {
        await updateMutation.mutateAsync({
          oidc: {
            enabled: value.enabled,
            ...(value.issuerUrl.trim().length === 0 ? {} : { issuerUrl: value.issuerUrl.trim() }),
            ...(value.clientId.trim().length === 0 ? {} : { clientId: value.clientId.trim() }),
            providerPreset: value.providerPreset,
            groupClaim: value.groupClaim.trim() || 'groups',
            adminGroups: csvInput(value.adminGroups),
            groupMap: mappingInput(value.groupMap),
            workspaceGroupMap: mappingInput(value.workspaceGroupMap),
            workspaceGroupPrefix: value.workspaceGroupPrefix.trim()
          }
        })
        toast('SSO settings saved', 'success')
        form.reset()
      } catch {
        toast('Could not save SSO settings', 'error')
      }
    }
  })

  function handleTest() {
    try {
      testMutation.mutate()
      toast('SSO connection tested', 'success')
    } catch {
      toast('Could not test SSO connection', 'error')
    }
  }

  function handleRefresh() {
    try {
      void ssoQuery.refetch()
      toast('SSO settings refreshed', 'success')
    } catch {
      toast('Could not refresh SSO settings', 'error')
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">SSO</div>
        <div className="flex items-center gap-2">
          <button className="rm-button" disabled={testMutation.isPending} onClick={handleTest} type="button">
            {testMutation.isPending ? 'Testing' : 'Test'}
          </button>
          <button className="rm-button" disabled={ssoQuery.isFetching} onClick={handleRefresh} type="button">
            {ssoQuery.isFetching ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="mb-3 text-sm font-medium">{settings?.status ?? 'loading'}</div>
      <div className="grid min-w-0 gap-2 text-sm">
        <div className="min-w-0 rounded-md border border-border p-2">
          <div className="font-medium">OIDC</div>
          <div className="break-words text-muted">
            {settings?.configurationSource ?? 'environment'} / {settings?.oidc.detectedProviderPreset ?? 'generic'} / {settings?.oidc.issuerHost ?? 'not configured'} / {settings?.oidc.groupClaim ?? 'groups'}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="admin groups" value={settings?.oidc.adminGroupCount ?? 0} />
          <Metric label="group maps" value={settings?.oidc.groupMappingCount ?? 0} />
          <Metric label="workspace maps" value={settings?.oidc.workspaceGroupMappingCount ?? 0} />
          <Metric label="PKCE" value={settings?.oidc.browserPkceLoginEnabled ? 'on' : 'off'} />
        </div>
        {(test !== undefined || testMutation.error !== null) && (
          <div className="min-w-0 rounded-md border border-border p-2">
            <div className="font-medium">Connection {test?.status ?? 'failed'}</div>
            <div className="break-words text-muted">
              {test?.checks.map((check) => `${check.id}:${check.status}`).join(' / ') ?? 'request failed'}
            </div>
          </div>
        )}
        <form
          className="grid min-w-0 gap-2 rounded-md border border-border p-2"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <label className="flex items-center gap-2 text-xs">
            <form.Field name="enabled">
              {(field) => (
                <input checked={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.checked)} type="checkbox" />
              )}
            </form.Field>
            <span>Enable OIDC</span>
          </label>
          <form.Field name="issuerUrl">
            {(field) => (
              <input className="rm-input" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} placeholder="Issuer URL" value={field.state.value} />
            )}
          </form.Field>
          <form.Field name="clientId">
            {(field) => (
              <input className="rm-input" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} placeholder="Client ID" value={field.state.value} />
            )}
          </form.Field>
          <form.Field name="providerPreset">
            {(field) => (
              <select
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.currentTarget.value as SsoOidcProviderPresetId
                  field.handleChange(value)
                  const preset = settings?.oidc.providerPresets.find((item) => item.id === value)
                  if (preset !== undefined) field.form.setFieldValue('groupClaim', preset.recommendedGroupClaim)
                }}
                value={field.state.value}
              >
                {(settings?.oidc.providerPresets ?? []).map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
            )}
          </form.Field>
          <form.Field name="groupClaim">
            {(field) => (
              <input className="rm-input" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} placeholder="Group claim" value={field.state.value} />
            )}
          </form.Field>
          <form.Field name="adminGroups">
            {(field) => (
              <input className="rm-input" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} placeholder="Admin groups" value={field.state.value} />
            )}
          </form.Field>
          <form.Field name="groupMap">
            {(field) => (
              <input className="rm-input" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} placeholder="Group map" value={field.state.value} />
            )}
          </form.Field>
          <form.Field name="workspaceGroupMap">
            {(field) => (
              <input className="rm-input" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} placeholder="Workspace group map" value={field.state.value} />
            )}
          </form.Field>
          <form.Field name="workspaceGroupPrefix">
            {(field) => (
              <input className="rm-input" onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.currentTarget.value)} placeholder="Workspace prefix" value={field.state.value} />
            )}
          </form.Field>
          <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
            {({ canSubmit, isSubmitting }) => (
              <button className="rm-button" disabled={updateMutation.isPending || !canSubmit || isSubmitting} type="submit">
                {updateMutation.isPending ? 'Saving' : 'Save'}
              </button>
            )}
          </form.Subscribe>
        </form>
        {updateMutation.error ? <div className="text-xs text-red-600">Save failed</div> : null}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-md border border-border p-2">
      <div className="truncate text-muted">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}

function csvInput(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
}

function mappingInput(value: string): Record<string, string> {
  const output: Record<string, string> = {}
  for (const item of csvInput(value)) {
    const [key, mapped] = item.split('=', 2)
    if (key !== undefined && mapped !== undefined && key.length > 0 && mapped.length > 0) output[key] = mapped
  }
  return output
}
