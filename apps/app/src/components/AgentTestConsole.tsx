import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'

import { createChat, startRun, streamRunEvents } from '../api/client'
import type { Agent } from '../api/types'

interface AgentTestConsoleProps {
  activeAgent: Agent | undefined
  workspaceId: string | undefined
}

const defaultPrompt = 'Summarize your current operating mode in two sentences.'

export function AgentTestConsole({ activeAgent, workspaceId }: AgentTestConsoleProps) {
  const queryClient = useQueryClient()
  const [citations, setCitations] = useState<Array<{ chunkId: string; title: string }>>([])
  const [result, setResult] = useState('')
  const [runId, setRunId] = useState<string>()
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle')
  const [error, setError] = useState<string>()

  const form = useForm({
    defaultValues: { prompt: defaultPrompt },
    onSubmit: async ({ value }) => {
      const content = value.prompt.trim()
      if (!activeAgent || !workspaceId || content.length === 0 || status === 'running') return

      setError(undefined)
      setCitations([])
      setResult('')
      setRunId(undefined)
      setStatus('running')

      try {
        const chat = await createChat({ workspaceId, title: `Agent test: ${content.slice(0, 48)}` })
        const run = await startRun({ chatId: chat.id, agentId: activeAgent.id, content })
        setRunId(run.id)
        for await (const event of streamRunEvents(run.id)) {
          if (event.type === 'retrieval.completed') setCitations(readCitations(event.data))
          if (event.type === 'message.delta') appendDelta((event.data as { text?: string }).text ?? '')
          if (event.type === 'run.failed') setStatus('failed')
          if (event.type === 'run.completed') setStatus('completed')
        }
        await refreshRunData(workspaceId)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to run agent test.')
        setStatus('failed')
      }
    }
  })
  const promptValue = useStore(form.store, (state) => state.values.prompt)

  async function refreshRunData(currentWorkspaceId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['chats', currentWorkspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['usageEvents'] }),
      queryClient.invalidateQueries({ queryKey: ['usageSummary'] }),
      queryClient.invalidateQueries({ queryKey: ['usageAlerts'] }),
      queryClient.invalidateQueries({ queryKey: ['quotas'] })
    ])
  }

  function appendDelta(delta: string) {
    setResult((current) => current + delta)
  }

  return (
    <div className="mt-5 grid gap-3 border-t border-border pt-4">
      <div className="text-sm text-muted">Test console</div>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <label className="text-sm text-muted" htmlFor="agent-test-prompt">
          Test prompt
        </label>
        <form.Field name="prompt">
          {(field) => (
            <textarea
              className="rm-textarea"
              disabled={!activeAgent || !workspaceId || status === 'running'}
              id="agent-test-prompt"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              rows={3}
              value={field.state.value}
            />
          )}
        </form.Field>
        <button className="rm-button" disabled={!activeAgent || !workspaceId || status === 'running' || promptValue.trim().length === 0} type="submit">
          {status === 'running' ? 'Running' : 'Run test'}
        </button>
      </form>
      {runId ? <div className="break-all text-xs text-muted">{runId}</div> : null}
      {error ? <div className="text-sm text-muted">{error}</div> : null}
      {result ? <div className="rounded-md border border-border p-3 text-sm leading-6">{result}</div> : null}
      {citations.length > 0 ? (
        <div className="grid gap-1 text-xs text-muted">
          {citations.map((citation, index) => (
            <div className="break-words" key={`${citation.chunkId}-${index}`}>
              [{index + 1}] {citation.title}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function readCitations(data: unknown): Array<{ chunkId: string; title: string }> {
  if (typeof data !== 'object' || data === null || !('citations' in data) || !Array.isArray(data.citations)) return []
  return data.citations.flatMap((citation) => {
    if (typeof citation !== 'object' || citation === null) return []
    const chunkId = 'chunkId' in citation && typeof citation.chunkId === 'string' ? citation.chunkId : ''
    const title = 'title' in citation && typeof citation.title === 'string' ? citation.title : ''
    return chunkId && title ? [{ chunkId, title }] : []
  })
}
