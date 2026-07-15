import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiClientError } from '../api/http'
import { executeTool } from '../api/tools'
import type { Agent, AgentToolSummary } from '../api/types'

export interface PendingToolApproval {
  approvalRequestId: string
  toolId: string
  name: string
  riskLevel: string
  approvalPolicy: string
  inputKeys: string[]
}

export function useToolExecution(activeAgent: Agent | undefined, tools: AgentToolSummary[], onError: (message: string | undefined) => void) {
  const queryClient = useQueryClient()
  const [toolResult, setToolResult] = useState<string>()
  const [pendingApproval, setPendingApproval] = useState<PendingToolApproval>()
  const calculatorMutation = useMutation({
    mutationFn: (input: { agentId: string; expression: string }) =>
      executeTool<{ result: number }>({ toolId: 'tool_calculator', agentId: input.agentId, payload: { expression: input.expression } })
  })
  const dateTimeMutation = useMutation({
    mutationFn: (input: { agentId: string; approved: boolean; approvalRequestId?: string }) =>
      executeTool<{ iso: string; timeZone: string }>({
        toolId: 'tool_datetime',
        agentId: input.agentId,
        payload: dateTimePayload(),
        approved: input.approved,
        ...(input.approvalRequestId === undefined ? {} : { approvalRequestId: input.approvalRequestId })
      })
  })

  async function handleExecuteCalculator(expression: string) {
    if (!activeAgent) return
    onError(undefined)
    try {
      const result = await calculatorMutation.mutateAsync({ agentId: activeAgent.id, expression })
      setToolResult(String(result.result))
      await refreshToolControls()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Unable to execute tool.')
    }
  }

  async function handleExecuteDateTime() {
    if (!activeAgent) return
    onError(undefined)
    try {
      await runDateTime(activeAgent.id, false)
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === 'tool_approval_required') {
        const approvalRequestId = typeof caught.details.approvalRequestId === 'string' ? caught.details.approvalRequestId : undefined
        if (approvalRequestId === undefined) {
          onError('Tool approval request was not returned by the server.')
          return
        }
        const tool = tools.find((item) => item.id === 'tool_datetime')
        setPendingApproval({
          approvalRequestId,
          toolId: 'tool_datetime',
          name: tool?.name ?? 'Date/time',
          riskLevel: tool?.riskLevel ?? 'low',
          approvalPolicy: tool?.approvalRequired === true ? 'agent_binding' : tool?.approvalPolicy ?? 'always',
          inputKeys: ['timeZone']
        })
        await refreshToolControls()
        return
      }
      onError(caught instanceof Error ? caught.message : 'Unable to execute tool.')
    }
  }

  async function approvePendingTool() {
    if (!activeAgent || pendingApproval?.toolId !== 'tool_datetime') return
    onError(undefined)
    try {
      await runDateTime(activeAgent.id, true, pendingApproval.approvalRequestId)
      setPendingApproval(undefined)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Unable to execute tool.')
    }
  }

  function cancelPendingTool() {
    setPendingApproval(undefined)
  }

  async function runDateTime(agentId: string, approved: boolean, approvalRequestId?: string) {
    const result = await dateTimeMutation.mutateAsync({ agentId, approved, ...(approvalRequestId === undefined ? {} : { approvalRequestId }) })
    setToolResult(`${result.timeZone}: ${result.iso}`)
    await refreshToolControls()
  }

  async function refreshToolControls() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['usageEvents'] }),
      queryClient.invalidateQueries({ queryKey: ['usageSummary'] }),
      queryClient.invalidateQueries({ queryKey: ['usageAlerts'] }),
      queryClient.invalidateQueries({ queryKey: ['quotas'] }),
      queryClient.invalidateQueries({ queryKey: ['toolCalls'] }),
      queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
    ])
  }

  return {
    approvePendingTool,
    cancelPendingTool,
    handleExecuteCalculator,
    handleExecuteDateTime,
    isExecutingTool: calculatorMutation.isPending || dateTimeMutation.isPending,
    pendingApproval,
    toolResult
  }
}

function dateTimePayload() {
  return { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}
