import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createChatComment, listChatComments } from '../api/client'
import { toast } from '../lib/toast'

export function ChatCommentPanel({ activeChatId }: { activeChatId: string | undefined }) {
  const queryClient = useQueryClient()
  const commentsQuery = useQuery({
    queryKey: ['chatComments', activeChatId],
    queryFn: () => listChatComments(activeChatId!),
    enabled: activeChatId !== undefined
  })
  const commentMutation = useMutation({ mutationFn: createChatComment })

  const commentForm = useForm({
    defaultValues: { body: '' },
    onSubmit: async ({ value }) => {
      if (activeChatId === undefined) return
      try {
        await commentMutation.mutateAsync({ chatId: activeChatId, body: value.body.trim() })
        commentForm.reset()
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['chatComments', activeChatId] }),
          queryClient.invalidateQueries({ queryKey: ['notifications'] }),
          queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
        ])
        toast('Comment added', 'success')
      } catch {
        toast('Could not add comment', 'error')
      }
    }
  })

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">Chat comments</div>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void commentForm.handleSubmit()
        }}
      >
        <label className="sr-only" htmlFor="chat-comment-body">
          Comment
        </label>
        <commentForm.Field
          name="body"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Comment is required' : undefined) }}
        >
          {(field) => (
            <>
              <textarea
                className="rm-input min-h-20 resize-y"
                disabled={activeChatId === undefined}
                id="chat-comment-body"
                maxLength={5000}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </commentForm.Field>
        <commentForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button
              className="rm-button"
              disabled={!canSubmit || isSubmitting || activeChatId === undefined || commentMutation.isPending}
              type="submit"
            >
              Comment
            </button>
          )}
        </commentForm.Subscribe>
      </form>
      <div className="mt-4 grid gap-2 text-sm">
        {(commentsQuery.data ?? []).slice(-4).map((comment) => (
          <article className="rounded-md border border-border p-2" key={comment.id}>
            <div className="font-medium break-all">{comment.authorId}</div>
            <p className="whitespace-pre-wrap break-words text-muted">{comment.body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
