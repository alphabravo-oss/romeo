import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  createManagedSecret,
  deprovisionSsoOidcUser,
  getAuthProviderCatalog,
  getAuthProviderSettings,
  testAuthProviderConnection,
  triggerDirectorySync,
  updateAuthProviderSettings
} from '../api/auth-provider-client'
import { getBootstrap } from '../api/bootstrap-client'
import type {
  AuthProviderCatalogEntry,
  AuthProviderConnectionTestReport,
  AuthProviderGlobalPatch,
  AuthProviderId,
  AuthProviderOrgOverridePatch,
  DirectorySyncResult,
  EffectiveAuthProviderSetting,
  UpdateAuthProviderSettingsRequest
} from '../api/auth-provider-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { authProviderIcon } from './AuthProviderIcons'
import { useConfirm } from './ConfirmDialog'
import {
  DIRECTORY_SYNC_SOURCES,
  type DirectorySyncForm,
  buildDirectorySyncRequest,
  defaultDirectorySyncForm
} from './directory-sync-request'
import { FormDialog } from './FormDialog'
import { PanelStats } from './PanelStats'

type Scope = 'global' | 'org'

const SETTINGS_KEY = ['authProviderSettings'] as const
const CATALOG_KEY = ['authProviderCatalog'] as const

function isOidcish(protocol: string): boolean {
  return protocol === 'oidc' || protocol === 'oauth2'
}

/** Turn a textarea (one value per line) into a trimmed string[]. */
function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function AuthProvidersPanel(): React.ReactNode {
  const queryClient = useQueryClient()
  const { ask, dialog } = useConfirm()
  const [scope, setScope] = useState<Scope>('global')
  const [configuring, setConfiguring] = useState<AuthProviderCatalogEntry | null>(null)
  const [deprovisioning, setDeprovisioning] = useState<AuthProviderCatalogEntry | null>(null)
  const [testResults, setTestResults] = useState<Record<string, AuthProviderConnectionTestReport>>({})
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncForm, setSyncForm] = useState<DirectorySyncForm>(defaultDirectorySyncForm)
  const [syncPreview, setSyncPreview] = useState<DirectorySyncResult | null>(null)

  const catalogQuery = useQuery({ queryKey: CATALOG_KEY, queryFn: getAuthProviderCatalog })
  const settingsQuery = useQuery({ queryKey: SETTINGS_KEY, queryFn: getAuthProviderSettings })
  // Deploy-time tenancy (from /me). Single-tenant hides the org-scope switcher.
  const bootstrapQuery = useQuery({ queryKey: ['bootstrap'], queryFn: getBootstrap })
  const isMultiTenant = bootstrapQuery.data?.deployment?.tenancyMode === 'multi'

  const updateMutation = useMutation({ mutationFn: updateAuthProviderSettings })
  const testMutation = useMutation({ mutationFn: testAuthProviderConnection })
  const syncMutation = useMutation({ mutationFn: triggerDirectorySync })
  const deprovisionMutation = useMutation({ mutationFn: deprovisionSsoOidcUser })

  /** Wrap a providers[] patch array in the right scope envelope. */
  function envelope(
    providers: Array<AuthProviderGlobalPatch | AuthProviderOrgOverridePatch>,
    extra?: Pick<UpdateAuthProviderSettingsRequest, 'confirmDisableLocalFallback'>
  ): UpdateAuthProviderSettingsRequest {
    if (isMultiTenant && scope === 'org') {
      return {
        ...extra,
        orgOverride: { providers: providers as AuthProviderOrgOverridePatch[] }
      }
    }
    return {
      ...extra,
      global: { providers: providers as AuthProviderGlobalPatch[] }
    }
  }

  async function persist(
    providers: Array<AuthProviderGlobalPatch | AuthProviderOrgOverridePatch>,
    extra?: Pick<UpdateAuthProviderSettingsRequest, 'confirmDisableLocalFallback'>
  ): Promise<boolean> {
    try {
      await updateMutation.mutateAsync(envelope(providers, extra))
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY })
      toast('Authentication providers updated', 'success')
      return true
    } catch {
      toast('Could not update authentication providers', 'error')
      return false
    }
  }

  async function handleToggle(entry: AuthProviderCatalogEntry, next: boolean): Promise<void> {
    // Disabling the local provider removes the password/MFA fallback — guard it.
    if (entry.id === 'local' && !next) {
      const confirmed = await ask({
        title: 'Disable local login fallback?',
        body: 'Users will no longer be able to sign in with a password. Make sure another provider is configured and reachable first.',
        confirmLabel: 'Disable local login',
        tone: 'danger'
      })
      if (!confirmed) return
      await persist([{ providerId: entry.id, enabled: next }], { confirmDisableLocalFallback: true })
      return
    }
    await persist([{ providerId: entry.id, enabled: next }])
  }

  async function handleTest(entry: AuthProviderCatalogEntry): Promise<void> {
    try {
      const report = await testMutation.mutateAsync({ providerId: entry.id })
      setTestResults((prev) => ({ ...prev, [entry.id]: report }))
    } catch {
      toast('Connection test failed', 'error')
    }
  }

  function openDirectorySync(): void {
    setSyncForm(defaultDirectorySyncForm)
    setSyncPreview(null)
    setSyncOpen(true)
  }

  // Editing any option invalidates the current preview — apply is only allowed
  // against a plan the admin has actually previewed.
  function setSync<K extends keyof DirectorySyncForm>(key: K, value: DirectorySyncForm[K]): void {
    setSyncForm((prev) => ({ ...prev, [key]: value }))
    setSyncPreview(null)
  }

  // Preview: dryRun, no confirmApply — reports the disable/removal plan.
  async function handleSyncPreview(): Promise<void> {
    const built = buildDirectorySyncRequest(syncForm, { apply: false })
    if (!built.ok) {
      toast(built.error, 'error')
      return
    }
    try {
      setSyncPreview(await syncMutation.mutateAsync(built.request))
    } catch {
      toast('Directory sync preview failed', 'error')
    }
  }

  // Apply: destructive — gated behind a danger confirm that shows the previewed
  // counts, and sends the SAME options as the preview plus confirmApply.
  async function handleSyncApply(): Promise<void> {
    if (syncPreview === null) return
    const disables = syncPreview.changes.userDisables.count
    const removals = syncPreview.changes.membershipRemovals.count
    const confirmed = await ask({
      title: 'Apply directory sync?',
      body: `This disables ${disables} user(s) and removes ${removals} group membership(s). This cannot be undone from here.`,
      confirmLabel: 'Apply changes',
      tone: 'danger'
    })
    if (!confirmed) return
    const built = buildDirectorySyncRequest(syncForm, { apply: true })
    if (!built.ok) {
      toast(built.error, 'error')
      return
    }
    try {
      const result = await syncMutation.mutateAsync(built.request)
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setSyncPreview(null)
      setSyncOpen(false)
      toast(
        `Directory sync applied — ${result.changes.userDisables.count} disabled, ${result.changes.membershipRemovals.count} membership(s) removed`,
        'success'
      )
    } catch {
      toast('Directory sync failed', 'error')
    }
  }

  // Deprovisioning disables the mapped user for an OIDC subject — destructive.
  async function handleDeprovision(entry: AuthProviderCatalogEntry, oidcSubject: string): Promise<void> {
    const subject = oidcSubject.trim()
    if (subject.length === 0) return
    const confirmed = await ask({
      title: `Deprovision OIDC user from ${entry.name}?`,
      body: `The user mapped to subject "${subject}" will be disabled and lose access. This cannot be undone from here.`,
      confirmLabel: 'Deprovision',
      tone: 'danger'
    })
    if (!confirmed) return
    try {
      const result = await deprovisionMutation.mutateAsync({
        oidcSubject: subject,
        confirmOidcSubject: subject
      })
      setDeprovisioning(null)
      toast(
        result.status === 'already_disabled'
          ? 'OIDC user was already disabled'
          : 'OIDC user deprovisioned',
        'success'
      )
    } catch {
      toast('Could not deprovision OIDC user', 'error')
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title" style={{ margin: 0, padding: 0, border: 'none' }}>
          Authentication providers
        </div>
        <div className="flex items-center gap-2">
          <button className="rm-button" onClick={openDirectorySync} type="button">
            Sync directory
          </button>
        {isMultiTenant ? (
          <div className="flex items-center gap-1" role="group" aria-label="Configuration scope">
            <button
              aria-pressed={scope === 'global'}
              className={`rm-button${scope === 'global' ? ' selected' : ''}`}
              onClick={() => setScope('global')}
              type="button"
            >
              Global
            </button>
            <button
              aria-pressed={scope === 'org'}
              className={`rm-button${scope === 'org' ? ' selected' : ''}`}
              onClick={() => setScope('org')}
              type="button"
            >
              This organization
            </button>
          </div>
        ) : null}
        </div>
      </div>

      <PanelState query={catalogQuery} empty="No authentication providers in the catalog.">
        {(catalog) => (
          <PanelState query={settingsQuery} empty="No provider settings available.">
            {(settings) => {
              const effectiveById = new Map<AuthProviderId, EffectiveAuthProviderSetting>(
                settings.effective.providers.map((p) => [p.providerId, p])
              )
              const effective = settings.effective.providers
              const busy = updateMutation.isPending

              return (
                <div className="grid gap-4">
                  <PanelStats
                    items={[
                      { label: 'Total', value: catalog.length },
                      { label: 'Enabled', value: effective.filter((p) => p.enabled).length },
                      {
                        label: 'Configured',
                        value: effective.filter((p) => p.oidc?.issuerConfigured || p.secretRefConfigured).length
                      }
                    ]}
                  />

                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
                  >
                    {catalog.map((entry) => {
                      const setting = effectiveById.get(entry.id)
                      const planned = entry.status === 'planned'
                      const enabled = setting?.enabled ?? false
                      const source = setting?.source ?? 'default'
                      const test = testResults[entry.id]
                      const canTest = !planned && isOidcish(entry.protocol)

                      return (
                        <div
                          className="rm-panel"
                          key={entry.id}
                          style={{ padding: 14, opacity: planned ? 0.75 : 1 }}
                        >
                          <div className="flex items-start gap-3">
                            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                              {authProviderIcon(entry.id)}
                            </div>
                            <div className="min-w-0" style={{ flex: 1 }}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">{entry.name}</span>
                                {planned ? (
                                  <span className="rm-status" style={{ color: 'var(--rm-muted)' }}>
                                    Coming soon
                                  </span>
                                ) : (
                                  <span className={`rm-status ${enabled ? 'pass' : 'fail'}`}>
                                    {enabled ? 'On' : 'Off'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="rm-status rm-mono" style={{ fontSize: 11 }}>
                                  {entry.protocol}
                                </span>
                                <span
                                  className="rm-status"
                                  style={{ fontSize: 11, color: 'var(--rm-muted)' }}
                                >
                                  {source}
                                </span>
                              </div>
                            </div>
                          </div>

                          {setting?.disabledReason ? (
                            <div className="text-xs text-muted mt-2">{setting.disabledReason}</div>
                          ) : null}

                          {entry.id === 'local' ? (
                            <div className="text-xs text-muted mt-2">
                              Password &amp; MFA. Manage per-user credentials in Security settings.
                            </div>
                          ) : null}

                          {test ? (
                            <div className="mt-2 grid gap-1 rounded-md border border-border p-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted">Connection</span>
                                <span
                                  className={`rm-status ${
                                    test.status === 'passed'
                                      ? 'pass'
                                      : test.status === 'partial'
                                        ? 'warn'
                                        : 'fail'
                                  }`}
                                >
                                  {test.status}
                                </span>
                              </div>
                              {test.checks.map((check) => (
                                <div
                                  className="flex items-center justify-between text-xs"
                                  key={check.id}
                                >
                                  <span className="text-muted">{check.id}</span>
                                  <span
                                    className={`rm-status ${
                                      check.status === 'pass'
                                        ? 'pass'
                                        : check.status === 'skip'
                                          ? 'warn'
                                          : 'fail'
                                    }`}
                                  >
                                    {check.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            <button
                              className={`rm-button${enabled ? '' : ' primary'}`}
                              disabled={planned || busy}
                              onClick={() => void handleToggle(entry, !enabled)}
                              type="button"
                            >
                              {enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              className="rm-button"
                              disabled={planned}
                              onClick={() => setConfiguring(entry)}
                              type="button"
                            >
                              Configure
                            </button>
                            {canTest ? (
                              <button
                                className="rm-button"
                                disabled={testMutation.isPending}
                                onClick={() => void handleTest(entry)}
                                type="button"
                              >
                                {testMutation.isPending ? 'Testing' : 'Test'}
                              </button>
                            ) : null}
                            {canTest ? (
                              <button
                                className="rm-button danger"
                                disabled={deprovisionMutation.isPending}
                                onClick={() => setDeprovisioning(entry)}
                                type="button"
                              >
                                Deprovision
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            }}
          </PanelState>
        )}
      </PanelState>

      {configuring ? (
        <ConfigureDialog
          entry={configuring}
          scope={scope}
          setting={
            settingsQuery.data?.effective.providers.find((p) => p.providerId === configuring.id) ??
            null
          }
          saving={updateMutation.isPending}
          onClose={() => setConfiguring(null)}
          onSave={async (providers) => {
            const ok = await persist(providers)
            if (ok) setConfiguring(null)
          }}
        />
      ) : null}

      {deprovisioning ? (
        <DeprovisionDialog
          entry={deprovisioning}
          busy={deprovisionMutation.isPending}
          onClose={() => setDeprovisioning(null)}
          onSubmit={(oidcSubject) => void handleDeprovision(deprovisioning, oidcSubject)}
        />
      ) : null}

      <FormDialog
        description="Reconcile users and group memberships against your directory. Preview first, then apply."
        onClose={() => setSyncOpen(false)}
        open={syncOpen}
        title="Directory sync"
      >
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Source</span>
            <select
              className="rm-input"
              onChange={(event) => setSync('source', event.currentTarget.value as DirectorySyncForm['source'])}
              value={syncForm.source}
            >
              {DIRECTORY_SYNC_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-muted">Present users (emails)</span>
            <textarea
              className="rm-input"
              onChange={(event) => setSync('presentUserEmails', event.currentTarget.value)}
              placeholder="One email per line — users NOT listed may be disabled"
              rows={3}
              value={syncForm.presentUserEmails}
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-muted">Group memberships</span>
            <textarea
              className="rm-input"
              onChange={(event) => setSync('groupMemberships', event.currentTarget.value)}
              placeholder={'One group per line: groupId: userId1, userId2\nMembers NOT listed may be removed when enabled below.'}
              rows={3}
              value={syncForm.groupMemberships}
            />
          </label>

          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={syncForm.disableMissingUsers}
                onChange={(event) => setSync('disableMissingUsers', event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Disable users missing from the directory</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={syncForm.removeMissingGroupMembers}
                onChange={(event) => setSync('removeMissingGroupMembers', event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Remove group members missing from the directory</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={syncForm.preserveAdminUsers}
                onChange={(event) => setSync('preserveAdminUsers', event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Preserve admin users (never disable admins)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={syncForm.allowAdminUserDisable}
                onChange={(event) => setSync('allowAdminUserDisable', event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Allow disabling admin users (overrides preserve)</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Max user disables</span>
              <input
                className="rm-input"
                onChange={(event) => setSync('maxUserDisables', event.currentTarget.value)}
                placeholder="unlimited"
                type="number"
                value={syncForm.maxUserDisables}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Max membership removals</span>
              <input
                className="rm-input"
                onChange={(event) => setSync('maxMembershipRemovals', event.currentTarget.value)}
                placeholder="unlimited"
                type="number"
                value={syncForm.maxMembershipRemovals}
              />
            </label>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="text-muted">Reason (optional)</span>
            <input
              className="rm-input"
              onChange={(event) => setSync('reason', event.currentTarget.value)}
              placeholder="Recorded in the audit log"
              value={syncForm.reason}
            />
          </label>

          {syncPreview !== null ? (
            <div className="grid gap-2 border border-border rounded p-3">
              <div className="text-sm font-medium">Preview plan</div>
              <PanelStats
                items={[
                  { label: 'Users to disable', value: syncPreview.changes.userDisables.count },
                  { label: 'Memberships to remove', value: syncPreview.changes.membershipRemovals.count },
                  { label: 'Warnings', value: syncPreview.warnings.length }
                ]}
              />
              {syncPreview.warnings.length > 0 ? (
                <ul className="text-xs text-muted grid gap-1">
                  {syncPreview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              className="rm-button"
              disabled={syncMutation.isPending}
              onClick={() => void handleSyncPreview()}
              type="button"
            >
              {syncMutation.isPending ? 'Working' : 'Preview'}
            </button>
            <button
              className="rm-button danger"
              disabled={syncPreview === null || syncMutation.isPending}
              onClick={() => void handleSyncApply()}
              type="button"
            >
              Apply changes
            </button>
          </div>
        </div>
      </FormDialog>

      {dialog}
    </section>
  )
}

/**
 * Collects the OIDC subject to deprovision. Submitting hands the subject up to
 * the panel, which raises a destructive confirm (useConfirm) before calling the
 * deprovision endpoint. confirmOidcSubject is set to the same subject there.
 */
function DeprovisionDialog(props: {
  entry: AuthProviderCatalogEntry
  busy: boolean
  onClose: () => void
  onSubmit: (oidcSubject: string) => void
}): React.ReactNode {
  const { entry, busy, onClose, onSubmit } = props
  const [oidcSubject, setOidcSubject] = useState('')

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault()
    event.stopPropagation()
    onSubmit(oidcSubject)
  }

  return (
    <FormDialog
      open
      title={`Deprovision OIDC user — ${entry.name}`}
      description="Disables the user mapped to an OIDC subject and revokes their access."
      onClose={onClose}
    >
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <label className="text-sm text-muted" htmlFor="ap-deprovision-subject">
          OIDC subject
        </label>
        <input
          className="rm-input"
          id="ap-deprovision-subject"
          onChange={(event) => setOidcSubject(event.currentTarget.value)}
          placeholder="sub claim from the identity provider"
          value={oidcSubject}
        />
        <span className="text-xs text-muted">
          Uses the active OIDC issuer. You will be asked to confirm before the user is disabled.
        </span>

        <div className="flex justify-end gap-2">
          <button className="rm-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="rm-button primary danger"
            disabled={busy || oidcSubject.trim().length === 0}
            type="submit"
          >
            {busy ? 'Deprovisioning' : 'Continue'}
          </button>
        </div>
      </form>
    </FormDialog>
  )
}

/**
 * "Configure {name}" form. Prefills what the summary exposes (displayName,
 * loginOrder, allowedEmailDomains, groupClaim). Raw issuer/clientId are never
 * returned by the API, so those stay blank with a "leave blank to keep" hint;
 * we omit empty ones from the patch so they aren't cleared.
 *
 * v1 intentionally omits the groupMap / workspaceGroupMap key-value editors —
 * add a dedicated mapping editor later.
 */
function ConfigureDialog(props: {
  entry: AuthProviderCatalogEntry
  scope: Scope
  setting: EffectiveAuthProviderSetting | null
  saving: boolean
  onClose: () => void
  onSave: (providers: Array<AuthProviderGlobalPatch | AuthProviderOrgOverridePatch>) => void
}): React.ReactNode {
  const { entry, setting, saving, onClose, onSave } = props
  const showOidc = isOidcish(entry.protocol)
  const showSaml = entry.protocol === 'saml'
  const showLdap = entry.protocol === 'ldap'
  const isLocal = entry.id === 'local'

  const [displayName, setDisplayName] = useState(setting?.displayName ?? entry.name)
  const [loginOrder, setLoginOrder] = useState(String(setting?.loginOrder ?? 0))
  const [domains, setDomains] = useState((setting?.allowedEmailDomains ?? []).join('\n'))
  const [secretRef, setSecretRef] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [issuerUrl, setIssuerUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [groupClaim, setGroupClaim] = useState(setting?.oidc?.groupClaim ?? '')
  const [adminGroups, setAdminGroups] = useState('')
  const [workspaceGroupPrefix, setWorkspaceGroupPrefix] = useState('')
  // SAML — attributes prefill from the summary; endpoints stay blank ("leave blank to keep").
  const [samlEntryPoint, setSamlEntryPoint] = useState('')
  const [samlIdpIssuer, setSamlIdpIssuer] = useState('')
  const [samlSpEntityId, setSamlSpEntityId] = useState('')
  const [samlEmailAttribute, setSamlEmailAttribute] = useState(setting?.saml?.emailAttribute ?? '')
  const [samlNameAttribute, setSamlNameAttribute] = useState(setting?.saml?.nameAttribute ?? '')
  const [samlGroupsAttribute, setSamlGroupsAttribute] = useState(setting?.saml?.groupsAttribute ?? '')
  const [samlAdminGroups, setSamlAdminGroups] = useState('')
  const [samlSignedResponse, setSamlSignedResponse] = useState(setting?.saml?.signedResponseRequired ?? false)
  // LDAP — the summary only exposes booleans/counts, so endpoints/DNs use "leave blank to keep".
  const [ldapUrl, setLdapUrl] = useState('')
  const [ldapBindDn, setLdapBindDn] = useState('')
  const [ldapBaseDn, setLdapBaseDn] = useState('')
  const [ldapUserSearchFilter, setLdapUserSearchFilter] = useState('')
  const [ldapUserIdAttribute, setLdapUserIdAttribute] = useState('')
  const [ldapEmailAttribute, setLdapEmailAttribute] = useState('')
  const [ldapNameAttribute, setLdapNameAttribute] = useState('')
  const [ldapGroupSearchBaseDn, setLdapGroupSearchBaseDn] = useState('')
  const [ldapGroupSearchFilter, setLdapGroupSearchFilter] = useState('')
  const [ldapAdminGroups, setLdapAdminGroups] = useState('')
  const [ldapStartTls, setLdapStartTls] = useState(setting?.ldap?.startTls ?? false)

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    event.stopPropagation()

    // Build a patch with only changed/filled fields so we never clear values.
    const patch: AuthProviderGlobalPatch = { providerId: entry.id }
    if (displayName.trim().length > 0) patch.displayName = displayName.trim()
    const order = Number(loginOrder)
    if (Number.isFinite(order)) patch.loginOrder = order
    patch.allowedEmailDomains = linesToArray(domains)

    // Secret: a pasted client secret is stored via the managed-secret vault and
    // we save the returned ref; otherwise use a ref the admin entered directly.
    if (clientSecret.trim().length > 0) {
      try {
        const managed = await createManagedSecret({
          purpose: 'auth_provider_client_secret',
          value: clientSecret.trim(),
          scope: props.scope === 'org' ? 'org' : 'global'
        })
        patch.secretRef = managed.secretRef
      } catch {
        toast('Could not store client secret', 'error')
        return
      }
    } else if (secretRef.trim().length > 0) {
      patch.secretRef = secretRef.trim()
    }

    if (showOidc) {
      const oidc: NonNullable<AuthProviderGlobalPatch['oidc']> = {}
      if (issuerUrl.trim().length > 0) oidc.issuerUrl = issuerUrl.trim()
      if (clientId.trim().length > 0) oidc.clientId = clientId.trim()
      if (groupClaim.trim().length > 0) oidc.groupClaim = groupClaim.trim()
      const admins = linesToArray(adminGroups)
      if (admins.length > 0) oidc.adminGroups = admins
      if (workspaceGroupPrefix.trim().length > 0) oidc.workspaceGroupPrefix = workspaceGroupPrefix.trim()
      if (Object.keys(oidc).length > 0) patch.oidc = oidc
    }

    if (showSaml) {
      const saml: NonNullable<AuthProviderGlobalPatch['saml']> = {}
      if (samlEntryPoint.trim().length > 0) saml.entryPoint = samlEntryPoint.trim()
      if (samlIdpIssuer.trim().length > 0) saml.idpIssuer = samlIdpIssuer.trim()
      if (samlSpEntityId.trim().length > 0) saml.spEntityId = samlSpEntityId.trim()
      if (samlEmailAttribute.trim().length > 0) saml.emailAttribute = samlEmailAttribute.trim()
      if (samlNameAttribute.trim().length > 0) saml.nameAttribute = samlNameAttribute.trim()
      if (samlGroupsAttribute.trim().length > 0) saml.groupsAttribute = samlGroupsAttribute.trim()
      const samlAdmins = linesToArray(samlAdminGroups)
      if (samlAdmins.length > 0) saml.adminGroups = samlAdmins
      saml.wantAuthnResponseSigned = samlSignedResponse
      if (Object.keys(saml).length > 0) patch.saml = saml
    }

    if (showLdap) {
      const ldap: NonNullable<AuthProviderGlobalPatch['ldap']> = {}
      if (ldapUrl.trim().length > 0) ldap.url = ldapUrl.trim()
      if (ldapBindDn.trim().length > 0) ldap.bindDn = ldapBindDn.trim()
      if (ldapBaseDn.trim().length > 0) ldap.baseDn = ldapBaseDn.trim()
      if (ldapUserSearchFilter.trim().length > 0) ldap.userSearchFilter = ldapUserSearchFilter.trim()
      if (ldapUserIdAttribute.trim().length > 0) ldap.userIdAttribute = ldapUserIdAttribute.trim()
      if (ldapEmailAttribute.trim().length > 0) ldap.emailAttribute = ldapEmailAttribute.trim()
      if (ldapNameAttribute.trim().length > 0) ldap.nameAttribute = ldapNameAttribute.trim()
      if (ldapGroupSearchBaseDn.trim().length > 0) ldap.groupSearchBaseDn = ldapGroupSearchBaseDn.trim()
      if (ldapGroupSearchFilter.trim().length > 0) ldap.groupSearchFilter = ldapGroupSearchFilter.trim()
      const ldapAdmins = linesToArray(ldapAdminGroups)
      if (ldapAdmins.length > 0) ldap.adminGroups = ldapAdmins
      ldap.startTls = ldapStartTls
      if (Object.keys(ldap).length > 0) patch.ldap = ldap
    }

    onSave([patch])
  }

  return (
    <FormDialog open title={`Configure ${entry.name}`} onClose={onClose}>
      <form className="grid gap-3" onSubmit={(event) => void handleSubmit(event)}>
        <label className="text-sm text-muted" htmlFor="ap-display-name">
          Display name
        </label>
        <input
          className="rm-input"
          id="ap-display-name"
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          placeholder={entry.name}
          value={displayName}
        />

        <label className="text-sm text-muted" htmlFor="ap-login-order">
          Login order
        </label>
        <input
          className="rm-input"
          id="ap-login-order"
          onChange={(event) => setLoginOrder(event.currentTarget.value)}
          type="number"
          value={loginOrder}
        />

        <label className="text-sm text-muted" htmlFor="ap-domains">
          Allowed email domains (one per line)
        </label>
        <textarea
          className="rm-textarea"
          id="ap-domains"
          onChange={(event) => setDomains(event.currentTarget.value)}
          placeholder={'example.com\nsub.example.com'}
          rows={3}
          value={domains}
        />

        {isLocal ? null : (
          <>
            <label className="text-sm text-muted" htmlFor="ap-client-secret">
              Client secret
            </label>
            <input
              autoComplete="off"
              className="rm-input"
              id="ap-client-secret"
              onChange={(event) => setClientSecret(event.currentTarget.value)}
              placeholder="Paste the provider client secret"
              type="password"
              value={clientSecret}
            />
            <span className="text-xs text-muted">Stored securely; only a reference is kept. Leave blank to keep the current secret.</span>

            <label className="text-sm text-muted" htmlFor="ap-secret-ref">
              Secret reference (advanced)
            </label>
            <input
              className="rm-input"
              id="ap-secret-ref"
              onChange={(event) => setSecretRef(event.currentTarget.value)}
              placeholder="romeo-secret://… or vault://…"
              value={secretRef}
            />
            <span className="text-xs text-muted">Use an existing managed-secret reference instead of pasting a secret.</span>
          </>
        )}

        {showOidc ? (
          <>
            <label className="text-sm text-muted" htmlFor="ap-issuer">
              Issuer URL
            </label>
            <input
              className="rm-input"
              id="ap-issuer"
              onChange={(event) => setIssuerUrl(event.currentTarget.value)}
              placeholder={setting?.oidc?.issuerConfigured ? 'Configured — leave blank to keep' : 'https://issuer.example.com'}
              value={issuerUrl}
            />

            <label className="text-sm text-muted" htmlFor="ap-client-id">
              Client ID
            </label>
            <input
              className="rm-input"
              id="ap-client-id"
              onChange={(event) => setClientId(event.currentTarget.value)}
              placeholder={setting?.oidc?.clientIdConfigured ? 'Configured — leave blank to keep' : 'client-id'}
              value={clientId}
            />

            <label className="text-sm text-muted" htmlFor="ap-group-claim">
              Group claim
            </label>
            <input
              className="rm-input"
              id="ap-group-claim"
              onChange={(event) => setGroupClaim(event.currentTarget.value)}
              placeholder="groups"
              value={groupClaim}
            />

            <label className="text-sm text-muted" htmlFor="ap-admin-groups">
              Admin groups (one per line)
            </label>
            <textarea
              className="rm-textarea"
              id="ap-admin-groups"
              onChange={(event) => setAdminGroups(event.currentTarget.value)}
              placeholder={'platform-admins'}
              rows={2}
              value={adminGroups}
            />

            <label className="text-sm text-muted" htmlFor="ap-ws-prefix">
              Workspace group prefix
            </label>
            <input
              className="rm-input"
              id="ap-ws-prefix"
              onChange={(event) => setWorkspaceGroupPrefix(event.currentTarget.value)}
              placeholder="workspace-"
              value={workspaceGroupPrefix}
            />
          </>
        ) : null}

        {showSaml ? (
          <>
            <label className="text-sm text-muted" htmlFor="ap-saml-entrypoint">
              IdP SSO URL (entry point)
            </label>
            <input
              className="rm-input"
              id="ap-saml-entrypoint"
              onChange={(event) => setSamlEntryPoint(event.currentTarget.value)}
              placeholder={setting?.saml?.entryPointConfigured ? 'Configured — leave blank to keep' : 'https://idp.example.com/sso'}
              value={samlEntryPoint}
            />

            <label className="text-sm text-muted" htmlFor="ap-saml-issuer">
              IdP issuer / entity ID
            </label>
            <input
              className="rm-input"
              id="ap-saml-issuer"
              onChange={(event) => setSamlIdpIssuer(event.currentTarget.value)}
              placeholder={setting?.saml?.idpIssuerConfigured ? 'Configured — leave blank to keep' : 'https://idp.example.com/metadata'}
              value={samlIdpIssuer}
            />

            <label className="text-sm text-muted" htmlFor="ap-saml-sp">
              Service provider entity ID
            </label>
            <input
              className="rm-input"
              id="ap-saml-sp"
              onChange={(event) => setSamlSpEntityId(event.currentTarget.value)}
              placeholder={setting?.saml?.spEntityIdConfigured ? 'Configured — leave blank to keep' : 'romeo'}
              value={samlSpEntityId}
            />

            <label className="text-sm text-muted" htmlFor="ap-saml-email">
              Email attribute
            </label>
            <input
              className="rm-input"
              id="ap-saml-email"
              onChange={(event) => setSamlEmailAttribute(event.currentTarget.value)}
              placeholder="email"
              value={samlEmailAttribute}
            />

            <label className="text-sm text-muted" htmlFor="ap-saml-name">
              Name attribute
            </label>
            <input
              className="rm-input"
              id="ap-saml-name"
              onChange={(event) => setSamlNameAttribute(event.currentTarget.value)}
              placeholder="displayName"
              value={samlNameAttribute}
            />

            <label className="text-sm text-muted" htmlFor="ap-saml-groups">
              Groups attribute
            </label>
            <input
              className="rm-input"
              id="ap-saml-groups"
              onChange={(event) => setSamlGroupsAttribute(event.currentTarget.value)}
              placeholder="groups"
              value={samlGroupsAttribute}
            />

            <label className="text-sm text-muted" htmlFor="ap-saml-admins">
              Admin groups (one per line)
            </label>
            <textarea
              className="rm-textarea"
              id="ap-saml-admins"
              onChange={(event) => setSamlAdminGroups(event.currentTarget.value)}
              rows={2}
              value={samlAdminGroups}
            />

            <label className="inline-flex items-center gap-2 text-sm">
              <input checked={samlSignedResponse} onChange={(event) => setSamlSignedResponse(event.currentTarget.checked)} type="checkbox" />
              Require signed SAML response
            </label>
            <span className="text-xs text-muted">The IdP signing certificate is stored via the secret field above.</span>
          </>
        ) : null}

        {showLdap ? (
          <>
            <label className="text-sm text-muted" htmlFor="ap-ldap-url">
              Server URL
            </label>
            <input
              className="rm-input"
              id="ap-ldap-url"
              onChange={(event) => setLdapUrl(event.currentTarget.value)}
              placeholder={setting?.ldap?.urlConfigured ? 'Configured — leave blank to keep' : 'ldaps://ldap.example.com:636'}
              value={ldapUrl}
            />

            <label className="text-sm text-muted" htmlFor="ap-ldap-binddn">
              Bind DN
            </label>
            <input
              className="rm-input"
              id="ap-ldap-binddn"
              onChange={(event) => setLdapBindDn(event.currentTarget.value)}
              placeholder={setting?.ldap?.bindDnConfigured ? 'Configured — leave blank to keep' : 'cn=service,dc=example,dc=com'}
              value={ldapBindDn}
            />
            <span className="text-xs text-muted">The bind password is stored via the secret field above.</span>

            <label className="text-sm text-muted" htmlFor="ap-ldap-basedn">
              Base DN
            </label>
            <input
              className="rm-input"
              id="ap-ldap-basedn"
              onChange={(event) => setLdapBaseDn(event.currentTarget.value)}
              placeholder={setting?.ldap?.baseDnConfigured ? 'Configured — leave blank to keep' : 'ou=people,dc=example,dc=com'}
              value={ldapBaseDn}
            />

            <label className="text-sm text-muted" htmlFor="ap-ldap-userfilter">
              User search filter
            </label>
            <input
              className="rm-input"
              id="ap-ldap-userfilter"
              onChange={(event) => setLdapUserSearchFilter(event.currentTarget.value)}
              placeholder={setting?.ldap?.userSearchFilterConfigured ? 'Configured — leave blank to keep' : '(uid={{username}})'}
              value={ldapUserSearchFilter}
            />

            <label className="text-sm text-muted" htmlFor="ap-ldap-userid">
              User ID attribute
            </label>
            <input
              className="rm-input"
              id="ap-ldap-userid"
              onChange={(event) => setLdapUserIdAttribute(event.currentTarget.value)}
              placeholder="uid"
              value={ldapUserIdAttribute}
            />

            <label className="text-sm text-muted" htmlFor="ap-ldap-email">
              Email attribute
            </label>
            <input
              className="rm-input"
              id="ap-ldap-email"
              onChange={(event) => setLdapEmailAttribute(event.currentTarget.value)}
              placeholder="mail"
              value={ldapEmailAttribute}
            />

            <label className="text-sm text-muted" htmlFor="ap-ldap-name">
              Name attribute
            </label>
            <input
              className="rm-input"
              id="ap-ldap-name"
              onChange={(event) => setLdapNameAttribute(event.currentTarget.value)}
              placeholder="cn"
              value={ldapNameAttribute}
            />

            <label className="text-sm text-muted" htmlFor="ap-ldap-groupbase">
              Group search base DN
            </label>
            <input
              className="rm-input"
              id="ap-ldap-groupbase"
              onChange={(event) => setLdapGroupSearchBaseDn(event.currentTarget.value)}
              placeholder={setting?.ldap?.groupSearchConfigured ? 'Configured — leave blank to keep' : 'ou=groups,dc=example,dc=com'}
              value={ldapGroupSearchBaseDn}
            />

            <label className="text-sm text-muted" htmlFor="ap-ldap-groupfilter">
              Group search filter
            </label>
            <input
              className="rm-input"
              id="ap-ldap-groupfilter"
              onChange={(event) => setLdapGroupSearchFilter(event.currentTarget.value)}
              placeholder="(member={{dn}})"
              value={ldapGroupSearchFilter}
            />

            <label className="text-sm text-muted" htmlFor="ap-ldap-admins">
              Admin groups (one per line)
            </label>
            <textarea
              className="rm-textarea"
              id="ap-ldap-admins"
              onChange={(event) => setLdapAdminGroups(event.currentTarget.value)}
              rows={2}
              value={ldapAdminGroups}
            />

            <label className="inline-flex items-center gap-2 text-sm">
              <input checked={ldapStartTls} onChange={(event) => setLdapStartTls(event.currentTarget.checked)} type="checkbox" />
              Use StartTLS
            </label>
          </>
        ) : null}

        <div className="flex justify-end gap-2">
          <button className="rm-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="rm-button primary" disabled={saving} type="submit">
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </form>
    </FormDialog>
  )
}
