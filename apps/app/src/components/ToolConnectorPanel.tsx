import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import GlobeLock from 'lucide-react/dist/esm/icons/globe-lock.mjs'
import KeyRound from 'lucide-react/dist/esm/icons/key-round.mjs'
import Power from 'lucide-react/dist/esm/icons/power.mjs'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.mjs'
import Upload from 'lucide-react/dist/esm/icons/upload.mjs'
import { useState } from 'react'

import { checkToolConnectorAuth, importOpenApiTool, listToolConnectors, updateToolConnector, updateToolConnectorAuth, updateToolConnectorNetworkPolicy } from '../api/tools'
import type { ToolConnector, ToolConnectorAuthCheck } from '../api/types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { FormDialog } from './FormDialog'
import { PanelStats } from './PanelStats'
import { Tabs } from './Tabs'
import { ToolOperationList } from './ToolOperationList'

export function ToolConnectorPanel() {
  const queryClient = useQueryClient()
  const connectorsQuery = useQuery({ queryKey: ['toolConnectors'], queryFn: listToolConnectors })
  const authCheckMutation = useMutation({ mutationFn: checkToolConnectorAuth })
  const importMutation = useMutation({ mutationFn: importOpenApiTool })
  const connectorMutation = useMutation({ mutationFn: updateToolConnector })
  const authMutation = useMutation({ mutationFn: updateToolConnectorAuth })
  const networkPolicyMutation = useMutation({ mutationFn: updateToolConnectorNetworkPolicy })
  const [error, setError] = useState<string>()
  const [addOpen, setAddOpen] = useState(false)
  const [authChecks, setAuthChecks] = useState<Record<string, ToolConnectorAuthCheck>>({})

  const importForm = useForm({
    defaultValues: { name: '', specText: '' },
    onSubmit: async ({ value }) => {
      setError(undefined)
      try {
        const spec = JSON.parse(value.specText) as Record<string, unknown>
        await importMutation.mutateAsync({ name: value.name, spec })
        await queryClient.invalidateQueries({ queryKey: ['toolConnectors'] })
        toast('Connector imported', 'success')
        setAddOpen(false)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to import connector.')
        toast('Could not import connector', 'error')
      }
    }
  })

  async function handleSetAuthRef(connectorId: string) {
    setError(undefined)
    try {
      await authMutation.mutateAsync({ connectorId, type: 'api_key', secretRef: `vault://tools/${connectorId}/api-key` })
      await queryClient.invalidateQueries({ queryKey: ['toolConnectors'] })
      toast('API key ref set', 'success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update connector auth.')
      toast('Could not update connector auth', 'error')
    }
  }

  async function handleSetOAuthRef(connectorId: string) {
    setError(undefined)
    try {
      await authMutation.mutateAsync({ connectorId, type: 'oauth2_client_credentials', secretRef: `vault://tools/${connectorId}/oauth-client` })
      await queryClient.invalidateQueries({ queryKey: ['toolConnectors'] })
      toast('OAuth ref set', 'success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update connector auth.')
      toast('Could not update connector auth', 'error')
    }
  }

  async function handleToggleConnector(connectorId: string, enabled: boolean) {
    setError(undefined)
    try {
      await connectorMutation.mutateAsync({ connectorId, enabled })
      await queryClient.invalidateQueries({ queryKey: ['toolConnectors'] })
      toast(enabled ? 'Connector enabled' : 'Connector disabled', 'success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update connector.')
      toast('Could not update connector', 'error')
    }
  }

  async function handleAllowExampleHost(connectorId: string) {
    setError(undefined)
    try {
      await networkPolicyMutation.mutateAsync({ connectorId, mode: 'allow_hosts', allowedHosts: ['api.example.com'] })
      await queryClient.invalidateQueries({ queryKey: ['toolConnectors'] })
      toast('Network policy updated', 'success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update network policy.')
      toast('Could not update network policy', 'error')
    }
  }

  async function handleCheckAuth(connectorId: string) {
    setError(undefined)
    try {
      const check = await authCheckMutation.mutateAsync(connectorId)
      setAuthChecks((current) => ({ ...current, [connectorId]: check }))
      toast('Auth checked', 'success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to check connector auth.')
      toast('Could not check connector auth', 'error')
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Tool connectors</div>
        <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
          + Import tool
        </button>
      </div>
      <FormDialog open={addOpen} title="Import tool connector" onClose={() => setAddOpen(false)}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void importForm.handleSubmit()
        }}
      >
        <label className="text-sm text-muted" htmlFor="tool-connector-name">Name</label>
        <importForm.Field
          name="name"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Name is required' : undefined) }}
        >
          {(field) => (
            <>
              <input
                className="rm-input"
                id="tool-connector-name"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Connector name"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </importForm.Field>
        <label className="text-sm text-muted" htmlFor="openapi-spec">OpenAPI JSON</label>
        <importForm.Field
          name="specText"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'OpenAPI JSON is required' : undefined) }}
        >
          {(field) => (
            <>
              <textarea
                className="rm-input min-h-36 font-mono text-xs"
                id="openapi-spec"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Paste OpenAPI JSON"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </importForm.Field>
        <importForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button
              className="rm-button inline-flex items-center justify-center gap-2"
              disabled={!canSubmit || isSubmitting || importMutation.isPending}
              type="submit"
            >
              <Upload aria-hidden="true" size={16} />
              <span>{importMutation.isPending ? 'Importing' : 'Import OpenAPI'}</span>
            </button>
          )}
        </importForm.Subscribe>
      </form>
      </FormDialog>
      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      <div className="mt-4 grid gap-2 text-sm">
        <PanelState
          empty="No connectors imported."
          emptyAction={
            <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
              + Import tool
            </button>
          }
          query={connectorsQuery}
        >
          {(connectors) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total connectors', value: connectors.length },
                  { label: 'Enabled', value: connectors.filter((connector) => connector.enabled).length }
                ]}
              />
              <div className="grid gap-2">
                {connectors.slice(0, 5).map((connector) => (
            <div className="rounded-md border border-border p-2" key={connector.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">{connector.name}</div>
                <div className="text-xs text-muted">{connector.enabled ? 'Enabled' : 'Disabled'}</div>
              </div>
              <div className="text-muted">
                {connector.type} - {connector.approvalPolicy} - {connector.authConfig.configured === true ? 'auth ref set' : 'no auth ref'}
              </div>
              {authChecks[connector.id] !== undefined ? <div className="text-muted">{authCheckText(authChecks[connector.id]!)}</div> : null}
              <div className="text-muted">{networkPolicyText(connector.networkPolicy)}</div>
              <div className="mt-2">
                <Tabs
                  tabs={[
                    {
                      id: 'actions',
                      label: 'Connector',
                      content: (
                        <div className="flex flex-wrap gap-2">
                          <button className="rm-button inline-flex items-center gap-2" disabled={connectorMutation.isPending} onClick={() => void handleToggleConnector(connector.id, !connector.enabled)} type="button">
                            <Power aria-hidden="true" size={16} />
                            <span>{connector.enabled ? 'Disable' : 'Enable'}</span>
                          </button>
                          <button className="rm-button inline-flex items-center gap-2" disabled={authMutation.isPending} onClick={() => void handleSetAuthRef(connector.id)} type="button">
                            <KeyRound aria-hidden="true" size={16} />
                            <span>Set API key ref</span>
                          </button>
                          {hasOAuthHint(connector) ? (
                            <button className="rm-button inline-flex items-center gap-2" disabled={authMutation.isPending} onClick={() => void handleSetOAuthRef(connector.id)} type="button">
                              <KeyRound aria-hidden="true" size={16} />
                              <span>Set OAuth ref</span>
                            </button>
                          ) : null}
                          <button className="rm-button inline-flex items-center gap-2" disabled={authCheckMutation.isPending} onClick={() => void handleCheckAuth(connector.id)} type="button">
                            <ShieldCheck aria-hidden="true" size={16} />
                            <span>Check auth</span>
                          </button>
                          <button className="rm-button inline-flex items-center gap-2" disabled={networkPolicyMutation.isPending} onClick={() => void handleAllowExampleHost(connector.id)} type="button">
                            <GlobeLock aria-hidden="true" size={16} />
                            <span>Allow host</span>
                          </button>
                        </div>
                      )
                    },
                    {
                      id: 'operations',
                      label: 'Operations',
                      content: <ToolOperationList connectorId={connector.id} />
                    }
                  ]}
                />
              </div>
            </div>
                ))}
              </div>
            </div>
          )}
        </PanelState>
      </div>
    </section>
  )
}

function authCheckText(check: ToolConnectorAuthCheck): string {
  if (!check.configured) return 'secret check: not configured'
  if (check.available) return `secret check: available (${check.secretRefScheme ?? 'managed'})`
  return `secret check: ${check.failureCode ?? 'unavailable'}`
}

function networkPolicyText(policy: { mode: string; allowedHosts: string[] }): string {
  return policy.mode === 'allow_hosts' ? `network: ${policy.allowedHosts.join(', ')}` : 'network: deny all'
}

function hasOAuthHint(connector: ToolConnector): boolean {
  const hints = Array.isArray(connector.schema.authHints) ? connector.schema.authHints : []
  return hints.some((hint) => typeof hint === 'object' && hint !== null && !Array.isArray(hint) && (hint as { type?: unknown }).type === 'oauth2_client_credentials')
}
