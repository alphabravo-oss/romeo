import Archive from 'lucide-react/dist/esm/icons/archive.mjs'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.mjs'
import ShieldOff from 'lucide-react/dist/esm/icons/shield-off.mjs'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { archiveChat, updateChatLegalHold } from '../api/client'
import { toast } from '../lib/toast'

export function ChatLifecyclePanel({
  activeChatId,
  onChatArchived
}: {
  activeChatId: string | undefined
  onChatArchived: (chatId: string) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [holdDays, setHoldDays] = useState(30)
  const [notice, setNotice] = useState<string>()
  const archiveMutation = useMutation({ mutationFn: archiveChat })
  const legalHoldMutation = useMutation({
    mutationFn: (input: { chatId: string; legalHoldUntil?: string | null; legalHoldReason?: string }) => {
      const { chatId, ...body } = input
      return updateChatLegalHold(chatId, body)
    }
  })
  const hasActiveChat = activeChatId !== undefined
  const isBusy = archiveMutation.isPending || legalHoldMutation.isPending

  async function handleArchive() {
    if (activeChatId === undefined) return
    setNotice(undefined)
    try {
      const archived = await archiveMutation.mutateAsync(activeChatId)
      await onChatArchived(archived.id)
      setNotice('Chat archived.')
      toast('Chat archived', 'success')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Unable to archive chat.')
      toast('Could not archive chat', 'error')
    }
  }

  async function handleHold() {
    if (activeChatId === undefined) return
    setNotice(undefined)
    try {
      const legalHoldUntil = futureIsoTimestamp(holdDays)
      await legalHoldMutation.mutateAsync({ chatId: activeChatId, legalHoldUntil })
      await refreshLifecycleQueries(queryClient)
      setNotice('Legal hold updated.')
      toast('Legal hold updated', 'success')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Unable to update legal hold.')
      toast('Could not update legal hold', 'error')
    }
  }

  async function handleClearHold() {
    if (activeChatId === undefined) return
    setNotice(undefined)
    try {
      await legalHoldMutation.mutateAsync({ chatId: activeChatId, legalHoldUntil: null })
      await refreshLifecycleQueries(queryClient)
      setNotice('Legal hold cleared.')
      toast('Legal hold cleared', 'success')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Unable to clear legal hold.')
      toast('Could not clear legal hold', 'error')
    }
  }

  return (
    <div className="mt-4 grid gap-2 text-sm">
      <div className="text-muted">Chat lifecycle</div>
      <label className="text-muted" htmlFor="chat-legal-hold-days">
        Hold days
      </label>
      <input
        className="rm-input"
        disabled={!hasActiveChat || isBusy}
        id="chat-legal-hold-days"
        max={3650}
        min={1}
        onChange={(event) => setHoldDays(Number(event.currentTarget.value))}
        type="number"
        value={holdDays}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button className="rm-button inline-flex items-center justify-center gap-2" disabled={!hasActiveChat || isBusy} onClick={() => void handleArchive()} type="button">
          <Archive aria-hidden="true" size={16} />
          Archive
        </button>
        <button className="rm-button inline-flex items-center justify-center gap-2" disabled={!hasActiveChat || isBusy} onClick={() => void handleHold()} type="button">
          <ShieldCheck aria-hidden="true" size={16} />
          Hold
        </button>
        <button className="rm-button inline-flex items-center justify-center gap-2" disabled={!hasActiveChat || isBusy} onClick={() => void handleClearHold()} type="button">
          <ShieldOff aria-hidden="true" size={16} />
          Clear
        </button>
      </div>
      {notice ? <div className="text-xs text-muted">{notice}</div> : null}
    </div>
  )
}

async function refreshLifecycleQueries(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['chats'] }),
    queryClient.invalidateQueries({ queryKey: ['auditLogs'] }),
    queryClient.invalidateQueries({ queryKey: ['accessReview'] })
  ])
}

function futureIsoTimestamp(days: number): string {
  const boundedDays = Math.max(1, Math.min(3650, Number.isFinite(days) ? days : 30))
  return new Date(Date.now() + boundedDays * 24 * 60 * 60 * 1000).toISOString()
}
