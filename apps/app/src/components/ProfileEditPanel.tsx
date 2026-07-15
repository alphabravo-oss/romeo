import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { updateMyProfile } from '../api/bootstrap-client'
import { toast } from '../lib/toast'

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u

export function ProfileEditPanel({ currentName, currentEmail }: { currentName?: string | undefined; currentEmail?: string | undefined }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({ mutationFn: updateMyProfile })

  const form = useForm({
    defaultValues: { name: currentName ?? '', email: currentEmail ?? '' },
    onSubmit: async ({ value }) => {
      const input: { name?: string; email?: string } = {}
      if (value.name.trim()) input.name = value.name.trim()
      if (value.email.trim()) input.email = value.email.trim()
      if (Object.keys(input).length === 0) {
        toast('Enter a name or email to update', 'error')
        return
      }
      try {
        await mutation.mutateAsync(input)
        await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
        toast('Profile updated', 'success')
        form.reset()
      } catch {
        toast('Could not update profile', 'error')
      }
    }
  })

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">Profile</div>
      <p className="mt-1 text-xs text-muted">Update your display name or email.</p>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <form.Field name="name">
          {(field) => (
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Display name</span>
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="New display name"
                value={field.state.value}
              />
            </label>
          )}
        </form.Field>
        <form.Field
          name="email"
          validators={{
            onChange: ({ value }: { value: string }) => (value && !emailPattern.test(value) ? 'Enter a valid email' : undefined)
          }}
        >
          {(field) => (
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Email</span>
              <input
                autoComplete="email"
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="new@email.com"
                type="email"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div> : null}
            </label>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button primary" disabled={!canSubmit || isSubmitting || mutation.isPending} type="submit">
              {mutation.isPending ? 'Saving' : 'Save profile'}
            </button>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
