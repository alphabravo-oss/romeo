import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getAbuseControls,
  getEdgeSecurityPosture,
  updateAbuseControls
} from '../api/abuse-controls-client'
import type {
  AbuseControlPolicyReport,
  BillingStatus,
  EdgeSecurityPostureReport,
  UpdateAbuseControlPolicyRequest
} from '../api/abuse-controls-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { PanelStats } from './PanelStats'
import { Tabs } from './Tabs'

const billingStatuses: BillingStatus[] = ['active', 'canceled', 'past_due', 'trialing']

// Mirrors abuseControlIdSchema in packages/core/src/http/schemas.ts.
const ID_PATTERN = /^[A-Za-z0-9_.:/@-]+$/u
const ID_MAX_LENGTH = 200
const ID_LIST_MAX = 250

/** textarea (one-per-line) <-> string[] helpers. */
function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function arrayToLines(values: string[]): string {
  return values.join('\n')
}

/** Validate an id list against the backend regex + count/length limits. */
function validateIdList(label: string, values: string[]): string | undefined {
  if (values.length > ID_LIST_MAX) {
    return `${label}: at most ${ID_LIST_MAX} entries (got ${values.length}).`
  }
  for (const value of values) {
    if (value.length > ID_MAX_LENGTH) {
      return `${label}: "${value}" exceeds ${ID_MAX_LENGTH} characters.`
    }
    if (!ID_PATTERN.test(value)) {
      return `${label}: "${value}" has invalid characters (allowed: A-Z a-z 0-9 _ . : / @ -).`
    }
  }
  return undefined
}

export function AbuseControlsPanel() {
  return (
    <section className="rm-panel p-4">
      <Tabs
        tabs={[
          { id: 'controls', label: 'Controls', content: <ControlsTab /> },
          { id: 'edge', label: 'Edge posture', content: <EdgePostureTab /> }
        ]}
      />
    </section>
  )
}

function ControlsTab() {
  const queryClient = useQueryClient()
  const controlsQuery = useQuery({ queryKey: ['abuseControls'], queryFn: getAbuseControls })

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">Abuse controls</div>
        <button
          className="rm-button"
          disabled={controlsQuery.isFetching}
          onClick={() => void controlsQuery.refetch()}
          type="button"
        >
          {controlsQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <PanelState query={controlsQuery} empty="No abuse controls loaded." isEmpty={() => false}>
        {(report) => <ControlsEditor report={report} queryClient={queryClient} />}
      </PanelState>
    </div>
  )
}

function ControlsEditor(props: {
  report: AbuseControlPolicyReport
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const { report, queryClient } = props
  const updateMutation = useMutation({ mutationFn: updateAbuseControls })

  const form = useForm({
    defaultValues: {
      suspended: report.suspension.suspended,
      reasonCode: report.suspension.reasonCode ?? '',
      enforceBillingStatus: report.entitlements.enforceBillingStatus,
      denyWhenBillingPlanMissing: report.entitlements.denyWhenBillingPlanMissing,
      allowedBillingStatuses: report.entitlements.allowedBillingStatuses,
      connectorIds: arrayToLines(report.killSwitches.connectorIds),
      providerIds: arrayToLines(report.killSwitches.providerIds),
      toolIds: arrayToLines(report.killSwitches.toolIds),
      workerClasses: arrayToLines(report.killSwitches.workerClasses)
    },
    onSubmit: async ({ value }) => {
      const reasonCode = value.reasonCode.trim()

      // reasonCode is optional, but if present it must match the backend id regex.
      if (reasonCode.length > 0) {
        const reasonError = validateIdList('Suspension reason code', [reasonCode])
        if (reasonError) {
          toast(reasonError, 'error')
          return
        }
      }

      // Enforcing billing status with no allowed statuses would block everything.
      if (value.enforceBillingStatus && value.allowedBillingStatuses.length < 1) {
        toast('Select at least one allowed billing status when enforcing billing status.', 'error')
        return
      }

      const connectorIds = linesToArray(value.connectorIds)
      const providerIds = linesToArray(value.providerIds)
      const toolIds = linesToArray(value.toolIds)
      const workerClasses = linesToArray(value.workerClasses)

      const listError =
        validateIdList('Connector kill switches', connectorIds) ??
        validateIdList('Provider kill switches', providerIds) ??
        validateIdList('Tool kill switches', toolIds) ??
        validateIdList('Worker class kill switches', workerClasses)
      if (listError) {
        toast(listError, 'error')
        return
      }

      const input: UpdateAbuseControlPolicyRequest = {
        suspension: {
          suspended: value.suspended,
          // exactOptionalPropertyTypes: send null to clear, string to set — never undefined.
          reasonCode: reasonCode.length > 0 ? reasonCode : null
        },
        entitlements: {
          enforceBillingStatus: value.enforceBillingStatus,
          denyWhenBillingPlanMissing: value.denyWhenBillingPlanMissing,
          allowedBillingStatuses: value.allowedBillingStatuses
        },
        killSwitches: {
          connectorIds,
          providerIds,
          toolIds,
          workerClasses
        }
      }

      try {
        await updateMutation.mutateAsync(input)
        // Server normalizes (dedupe/sort) — re-render from the fresh report.
        await queryClient.invalidateQueries({ queryKey: ['abuseControls'] })
        toast('Abuse controls updated', 'success')
      } catch (caught) {
        toast('Could not update abuse controls', 'error')
        throw caught
      }
    }
  })

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: 'Source', value: report.source },
          { label: 'Suspended', value: report.suspension.suspended ? 'yes' : 'no' },
          { label: 'Cost work', value: report.enforcement.costWorkBlocked ? 'blocked' : 'allowed' },
          { label: 'Active kill switches', value: report.enforcement.activeKillSwitchCount },
          { label: 'Default block reasons', value: report.enforcement.defaultBlockReasons.length }
        ]}
      />

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <div className="rm-card-title">Suspension</div>
        <form.Field name="suspended">
          {(field) => (
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Organization suspended</span>
            </label>
          )}
        </form.Field>
        <form.Field name="reasonCode">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="abuse-reason-code">
                Suspension reason code (optional)
              </label>
              <input
                className="rm-input"
                id="abuse-reason-code"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="policy_violation"
                value={field.state.value}
              />
              <div className="text-xs text-muted">Empty clears the code. Allowed: A-Z a-z 0-9 _ . : / @ -</div>
            </div>
          )}
        </form.Field>

        <div className="rm-card-title">Entitlements</div>
        <form.Field name="enforceBillingStatus">
          {(field) => (
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Enforce billing status</span>
            </label>
          )}
        </form.Field>
        <form.Field name="denyWhenBillingPlanMissing">
          {(field) => (
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Deny cost work when billing plan is missing</span>
            </label>
          )}
        </form.Field>
        <form.Field name="allowedBillingStatuses">
          {(field) => (
            <div className="grid gap-1">
              <div className="text-sm text-muted">Allowed billing statuses</div>
              <div className="flex flex-wrap gap-3">
                {billingStatuses.map((status) => {
                  const checked = field.state.value.includes(status)
                  return (
                    <label className="flex items-center gap-2 text-sm" key={status}>
                      <input
                        checked={checked}
                        onChange={(event) => {
                          const next = event.currentTarget.checked
                            ? [...field.state.value, status]
                            : field.state.value.filter((value) => value !== status)
                          field.handleChange(next)
                        }}
                        type="checkbox"
                      />
                      <span>{status}</span>
                    </label>
                  )
                })}
              </div>
              <div className="text-xs text-muted">Required when enforcing billing status.</div>
            </div>
          )}
        </form.Field>

        <div className="rm-card-title">Kill switches (one id per line)</div>
        <form.Field name="connectorIds">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="abuse-connector-ids">
                Connector ids
              </label>
              <textarea
                className="rm-input"
                id="abuse-connector-ids"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder={'gmail\nslack'}
                rows={3}
                value={field.state.value}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="providerIds">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="abuse-provider-ids">
                Provider ids
              </label>
              <textarea
                className="rm-input"
                id="abuse-provider-ids"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder={'openai\nanthropic'}
                rows={3}
                value={field.state.value}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="toolIds">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="abuse-tool-ids">
                Tool ids
              </label>
              <textarea
                className="rm-input"
                id="abuse-tool-ids"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder={'web.search\nfile.write'}
                rows={3}
                value={field.state.value}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="workerClasses">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="abuse-worker-classes">
                Worker classes
              </label>
              <textarea
                className="rm-input"
                id="abuse-worker-classes"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder={'ingest\ndispatch'}
                rows={3}
                value={field.state.value}
              />
            </div>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <div className="flex items-center gap-2">
              <button className="rm-button primary" disabled={!canSubmit || isSubmitting} type="submit">
                {isSubmitting ? 'Saving' : 'Save controls'}
              </button>
              {report.updatedAt ? (
                <span className="text-xs text-muted">
                  Updated {new Date(report.updatedAt).toLocaleString()}
                  {report.updatedBy ? ` by ${report.updatedBy}` : ''}
                </span>
              ) : null}
            </div>
          )}
        </form.Subscribe>
      </form>
    </div>
  )
}

function EdgePostureTab() {
  const postureQuery = useQuery({ queryKey: ['edgeSecurityPosture'], queryFn: getEdgeSecurityPosture })

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">Edge security posture</div>
        <button
          className="rm-button"
          disabled={postureQuery.isFetching}
          onClick={() => void postureQuery.refetch()}
          type="button"
        >
          {postureQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <PanelState query={postureQuery} empty="No posture loaded." isEmpty={() => false}>
        {(report) => <EdgePostureView report={report} />}
      </PanelState>
    </div>
  )
}

function EdgePostureView(props: { report: EdgeSecurityPostureReport }) {
  const { report } = props
  const passCount = report.checks.filter((check) => check.status === 'pass').length
  const warnCount = report.checks.filter((check) => check.status === 'warn').length

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: 'Status', value: report.status === 'ready' ? 'ready' : 'attention required' },
          { label: 'Checks passing', value: passCount },
          { label: 'Checks warning', value: warnCount },
          { label: 'App origin', value: report.appOrigin.scheme },
          { label: 'WAF mode', value: report.ingress.wafMode }
        ]}
      />

      <div className="rm-card-title">TLS</div>
      <PanelStats
        items={[
          { label: 'App origin HTTPS', value: report.tls.appOriginHttps ? 'yes' : 'no' },
          { label: 'HSTS', value: report.tls.hstsEnabled ? 'enabled' : 'disabled' },
          { label: 'HSTS max-age (s)', value: report.tls.hstsMaxAgeSeconds },
          { label: 'Include subdomains', value: report.tls.hstsIncludeSubdomains ? 'yes' : 'no' },
          { label: 'Preload', value: report.tls.hstsPreload ? 'yes' : 'no' },
          { label: 'Termination', value: report.tls.termination }
        ]}
      />

      <div className="rm-card-title">Proxy & ingress</div>
      <PanelStats
        items={[
          { label: 'Proxy mode', value: report.proxy.mode },
          { label: 'Forwarded headers trusted', value: report.proxy.forwardedHeadersTrusted ? 'yes' : 'no' },
          { label: 'Allowed origin rules', value: report.ingress.allowedOriginRuleCount }
        ]}
      />

      <div className="rm-card-title">Rate limits</div>
      <PanelStats
        items={[
          { label: 'Driver', value: report.limits.rateLimit.driver },
          { label: 'Distributed', value: report.limits.rateLimit.distributed ? 'yes' : 'no' },
          { label: 'Window (s)', value: report.limits.rateLimit.windowSeconds },
          { label: 'Authenticated max', value: report.limits.rateLimit.authenticatedMax },
          { label: 'Auth max', value: report.limits.rateLimit.authMax },
          { label: 'Public max', value: report.limits.rateLimit.publicMax },
          { label: 'Webhook max', value: report.limits.rateLimit.webhookMax }
        ]}
      />

      <div className="rm-card-title">Size limits (bytes)</div>
      <PanelStats
        items={[
          { label: 'Request body', value: report.limits.requestBodyMaxBytes },
          { label: 'Direct upload', value: report.limits.files.directUploadMaxBytes },
          { label: 'Inline', value: report.limits.files.inlineMaxBytes },
          { label: 'Message attachment', value: report.limits.files.messageAttachmentMaxBytes },
          { label: 'Resumable upload', value: report.limits.files.resumableUploadMaxBytes }
        ]}
      />

      <div className="rm-card-header">
        <div className="rm-card-title">Checks</div>
        <span className="text-xs text-muted">
          Generated {new Date(report.generatedAt).toLocaleString()}
        </span>
      </div>
      <div className="grid gap-2">
        {report.checks.map((check) => (
          <div className="rm-card" key={check.id}>
            <div className="rm-card-header">
              <div className="rm-card-title">{check.id}</div>
              <span className={`rm-status ${check.status === 'pass' ? 'pass' : 'warn'}`}>{check.status}</span>
            </div>
            <div className="text-sm">{check.message}</div>
            <div className="mt-2 flex flex-wrap gap-3">
              {Object.entries(check.details).map(([key, value]) => (
                <span className="text-xs text-muted" key={key}>
                  <span className="rm-mono">{key}</span>: {String(value)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
