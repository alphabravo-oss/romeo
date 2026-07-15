import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  confirmTotpEnrollment,
  disableTotpFactor,
  getLocalAuthStatus,
  setLocalPassword,
  startTotpEnrollment
} from '../api/auth-client'
import type { TotpEnrollment } from '../api/auth-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { FormDialog } from './FormDialog'

export function AccountSecurityPanel() {
  const queryClient = useQueryClient()
  const { ask, dialog } = useConfirm()
  const statusQuery = useQuery({ queryKey: ['localAuthStatus'], queryFn: getLocalAuthStatus })

  const [pwOpen, setPwOpen] = useState(false)
  const [enrollment, setEnrollment] = useState<TotpEnrollment>()
  const [totpCode, setTotpCode] = useState('')

  const passwordMutation = useMutation({ mutationFn: setLocalPassword })
  const enrollMutation = useMutation({ mutationFn: startTotpEnrollment })
  const confirmMutation = useMutation({ mutationFn: confirmTotpEnrollment })
  const disableMutation = useMutation({ mutationFn: disableTotpFactor })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['localAuthStatus'] })

  const passwordForm = useForm({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    onSubmit: async ({ value }) => {
      if (value.newPassword !== value.confirmPassword) {
        toast('Passwords do not match', 'error')
        return
      }
      try {
        await passwordMutation.mutateAsync({
          newPassword: value.newPassword,
          ...(hasPassword ? { currentPassword: value.currentPassword } : {})
        })
        await refresh()
        toast(hasPassword ? 'Password changed' : 'Password set', 'success')
        passwordForm.reset()
        setPwOpen(false)
      } catch {
        toast('Could not update password', 'error')
      }
    }
  })

  async function handleStartEnrollment() {
    try {
      const result = await enrollMutation.mutateAsync({})
      setEnrollment(result)
      setTotpCode('')
    } catch {
      toast('Could not start enrollment', 'error')
    }
  }

  async function handleConfirmEnrollment() {
    if (enrollment === undefined || !/^\d{6}$/u.test(totpCode)) return
    try {
      await confirmMutation.mutateAsync({ factorId: enrollment.factor.id, code: totpCode })
      await refresh()
      toast('Authenticator app enabled', 'success')
      setEnrollment(undefined)
      setTotpCode('')
    } catch {
      toast('Could not verify code', 'error')
    }
  }

  async function handleDisableFactor(factorId: string) {
    if (!(await ask({ title: 'Remove this authenticator?', body: 'You will no longer be prompted for a code from this device.', confirmLabel: 'Remove', tone: 'danger' }))) return
    try {
      await disableMutation.mutateAsync({ factorId })
      await refresh()
      toast('Authenticator removed', 'success')
    } catch {
      toast('Could not remove authenticator', 'error')
    }
  }

  // Read once for the render + the password-form branch above (safe: query drives it).
  const hasPassword = statusQuery.data?.hasPassword ?? false

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">Security</div>
      <PanelState query={statusQuery} isEmpty={() => false} empty="">
        {(status) => (
          <div className="grid gap-5">
            {/* Password */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Password</div>
                  <div className="text-xs text-muted">
                    {status.hasPassword ? 'A password is set for local sign-in.' : 'No password set — you sign in with SSO only.'}
                  </div>
                </div>
                <button className="rm-button" onClick={() => setPwOpen(true)} type="button">
                  {status.hasPassword ? 'Change password' : 'Set password'}
                </button>
              </div>
            </div>

            {/* MFA */}
            <div className="grid gap-2 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Two-factor authentication</div>
                  <div className="text-xs text-muted">
                    {status.mfaEnabled ? 'An authenticator app is protecting your account.' : 'Add an authenticator app for a second sign-in factor.'}
                  </div>
                </div>
                <button
                  className="rm-button primary"
                  disabled={enrollMutation.isPending}
                  onClick={() => void handleStartEnrollment()}
                  type="button"
                >
                  {enrollMutation.isPending ? 'Starting' : 'Add authenticator app'}
                </button>
              </div>
              <div className="grid gap-2">
                {status.factors.filter((factor) => factor.disabledAt === undefined).map((factor) => (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3" key={factor.id}>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{factor.name || 'Authenticator app'}</div>
                      <div className="text-xs text-muted">
                        {factor.status}
                        {factor.lastUsedAt !== undefined ? ` · last used ${new Date(factor.lastUsedAt).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    <button className="rm-button danger" onClick={() => void handleDisableFactor(factor.id)} type="button">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </PanelState>

      {/* Password dialog */}
      <FormDialog
        open={pwOpen}
        title={hasPassword ? 'Change password' : 'Set password'}
        description="Use at least 12 characters."
        onClose={() => {
          passwordForm.reset()
          setPwOpen(false)
        }}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void passwordForm.handleSubmit()
          }}
        >
          {hasPassword ? (
            <passwordForm.Field
              name="currentPassword"
              validators={{ onChange: ({ value }: { value: string }) => (!value ? 'Current password is required' : undefined) }}
            >
              {(field) => (
                <label className="grid gap-1 text-sm">
                  <span className="text-muted">Current password</span>
                  <input
                    autoComplete="current-password"
                    className="rm-input"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    type="password"
                    value={field.state.value}
                  />
                  {field.state.meta.errors.length ? <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div> : null}
                </label>
              )}
            </passwordForm.Field>
          ) : null}
          <passwordForm.Field
            name="newPassword"
            validators={{ onChange: ({ value }: { value: string }) => (value.length < 12 ? 'At least 12 characters' : undefined) }}
          >
            {(field) => (
              <label className="grid gap-1 text-sm">
                <span className="text-muted">New password</span>
                <input
                  autoComplete="new-password"
                  className="rm-input"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  type="password"
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div> : null}
              </label>
            )}
          </passwordForm.Field>
          <passwordForm.Field name="confirmPassword">
            {(field) => (
              <label className="grid gap-1 text-sm">
                <span className="text-muted">Confirm new password</span>
                <input
                  autoComplete="new-password"
                  className="rm-input"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  type="password"
                  value={field.state.value}
                />
              </label>
            )}
          </passwordForm.Field>
          <passwordForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
            {({ canSubmit, isSubmitting }) => (
              <button className="rm-button primary" disabled={!canSubmit || isSubmitting || passwordMutation.isPending} type="submit">
                {passwordMutation.isPending ? 'Saving' : 'Save password'}
              </button>
            )}
          </passwordForm.Subscribe>
        </form>
      </FormDialog>

      {/* TOTP enrollment dialog */}
      <FormDialog
        open={enrollment !== undefined}
        title="Set up authenticator app"
        description="Scan the key in your authenticator app, then enter the 6-digit code."
        onClose={() => {
          setEnrollment(undefined)
          setTotpCode('')
        }}
      >
        {enrollment !== undefined ? (
          <div className="grid gap-3">
            <div className="grid gap-1 text-sm">
              <span className="text-muted">Setup key</span>
              <code className="rm-input break-all font-mono text-sm">{enrollment.secret}</code>
              <span className="text-xs text-muted">Enter this key manually, or use the URI below in an app that supports it.</span>
            </div>
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">otpauth URI</summary>
              <code className="mt-1 block break-all font-mono">{enrollment.otpauthUri}</code>
            </details>
            <label className="grid gap-1 text-sm">
              <span className="text-muted">6-digit code</span>
              <input
                autoComplete="one-time-code"
                className="rm-input"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setTotpCode(event.currentTarget.value.replace(/\D/gu, ''))}
                placeholder="000000"
                value={totpCode}
              />
            </label>
            <button
              className="rm-button primary"
              disabled={!/^\d{6}$/u.test(totpCode) || confirmMutation.isPending}
              onClick={() => void handleConfirmEnrollment()}
              type="button"
            >
              {confirmMutation.isPending ? 'Verifying' : 'Verify & enable'}
            </button>
          </div>
        ) : null}
      </FormDialog>

      {dialog}
    </section>
  )
}
