import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { listAgentKnowledgeBindings, updateAgentKnowledgeBinding } from '../api/client'
import type { Agent, KnowledgeBase } from '../api/types'

interface AgentKnowledgeBindingControlsProps {
  activeAgent: Agent | undefined
  activeKnowledgeBase: KnowledgeBase | undefined
}

export function AgentKnowledgeBindingControls({ activeAgent, activeKnowledgeBase }: AgentKnowledgeBindingControlsProps) {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string>()
  const bindingsQuery = useQuery({
    queryKey: ['agentKnowledgeBindings', activeAgent?.id],
    queryFn: () => listAgentKnowledgeBindings(activeAgent!.id),
    enabled: activeAgent !== undefined
  })
  const bindings = useMemo(() => bindingsQuery.data ?? [], [bindingsQuery.data])
  const activeBinding = bindings.find((binding) => binding.knowledgeBaseId === activeKnowledgeBase?.id)
  const updateMutation = useMutation({ mutationFn: updateAgentKnowledgeBinding })

  async function handleToggle() {
    if (!activeAgent || !activeKnowledgeBase) return
    const enabled = activeBinding?.enabled !== true
    const binding = await updateMutation.mutateAsync({
      agentId: activeAgent.id,
      knowledgeBaseId: activeKnowledgeBase.id,
      enabled
    })
    setNotice(binding.enabled ? 'Knowledge bound to agent.' : 'Knowledge disabled for agent.')
    await queryClient.invalidateQueries({ queryKey: ['agentKnowledgeBindings', activeAgent.id] })
  }

  return (
    <div className="mt-4 grid gap-2 border-t border-border pt-4 text-sm">
      <div className="text-muted">Agent binding</div>
      <div className="grid gap-1">
        <span className="break-words">{activeAgent?.name ?? 'No agent'}</span>
        <span className="text-muted">{bindingState(activeBinding?.enabled)}</span>
      </div>
      <button className="rm-button" disabled={!activeAgent || !activeKnowledgeBase || updateMutation.isPending} onClick={() => void handleToggle()} type="button">
        {activeBinding?.enabled === true ? 'Disable for agent' : 'Bind to agent'}
      </button>
      {notice ? <div className="text-muted">{notice}</div> : null}
    </div>
  )
}

function bindingState(enabled: boolean | undefined): string {
  if (enabled === true) return 'Enabled'
  if (enabled === false) return 'Disabled'
  return 'Not bound'
}
