import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle.mjs'
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.mjs'
import Play from 'lucide-react/dist/esm/icons/play.mjs'
import Power from 'lucide-react/dist/esm/icons/power.mjs'
import { useMemo, useState } from 'react'

import { ApiClientError } from '../api/http'
import { dispatchToolOperation, listToolOperations, testToolOperation, updateToolOperation } from '../api/tools'
import type { ToolOperation, ToolOperationDispatchResult, ToolOperationTestPreview } from '../api/types'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { ToolOperationTestResult } from './ToolOperationTestResult'

const col = createColumnHelper<ToolOperation>()

export function ToolOperationList({ connectorId }: { connectorId: string }) {
  const queryClient = useQueryClient()
  const operationsQuery = useQuery({
    queryKey: ['toolOperations', connectorId],
    queryFn: () => listToolOperations(connectorId)
  })
  const testMutation = useMutation({ mutationFn: testToolOperation })
  const operationMutation = useMutation({ mutationFn: updateToolOperation })
  const dispatchMutation = useMutation({ mutationFn: dispatchToolOperation })
  const [preview, setPreview] = useState<ToolOperationTestPreview>()
  const [dispatchResults, setDispatchResults] = useState<Record<string, ToolOperationDispatchResult>>({})
  const [approvalRequests, setApprovalRequests] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  const operations = operationsQuery.data ?? []

  async function handleTest(operation: ToolOperation) {
    setError(undefined)
    try {
      const input = { connectorId, operationId: operation.operationId }
      const result = await testMutation.mutateAsync(operation.method === 'get' ? input : { ...input, body: { sample: true } })
      setPreview(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to test operation.')
    }
  }

  async function handleToggleOperation(operation: ToolOperation) {
    setError(undefined)
    try {
      await operationMutation.mutateAsync({ connectorId, operationId: operation.operationId, enabled: !operation.enabled })
      await queryClient.invalidateQueries({ queryKey: ['toolOperations', connectorId] })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update operation.')
    }
  }

  async function handleDispatch(operation: ToolOperation, approved = false) {
    setError(undefined)
    const baseInput = operation.method === 'get'
      ? { connectorId, operationId: operation.operationId }
      : { connectorId, operationId: operation.operationId, body: { sample: true } }
    const approvalRequestId = approvalRequests[operation.operationId]
    if (approved && approvalRequestId === undefined) {
      setError('Approval request is missing.')
      return
    }
    try {
      const result = await dispatchMutation.mutateAsync({
        ...baseInput,
        ...(approved ? { approved: true, approvalRequestId } : {})
      })
      setDispatchResults((current) => ({ ...current, [operation.operationId]: result }))
      setApprovalRequests((current) => {
        const next = { ...current }
        delete next[operation.operationId]
        return next
      })
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === 'tool_operation_approval_required') {
        const approvalRequestId = typeof caught.details.approvalRequestId === 'string' ? caught.details.approvalRequestId : undefined
        if (approvalRequestId !== undefined) {
          setApprovalRequests((current) => ({ ...current, [operation.operationId]: approvalRequestId }))
          setError('Approval required before dispatch.')
          return
        }
      }
      setError(caught instanceof Error ? caught.message : 'Unable to dispatch operation.')
    }
  }

  const columns = useMemo<ColumnDef<ToolOperation, any>[]>(
    () => [
      col.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      col.accessor((row) => `${row.method.toUpperCase()} ${row.path}`, {
        id: 'endpoint',
        header: 'Method',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      }),
      col.accessor((row) => (row.enabled ? 'enabled' : 'disabled'), {
        id: 'enabled',
        header: 'Status',
        cell: (c) => (
          <span className={`rm-status ${c.getValue() === 'enabled' ? 'pass' : 'fail'}`}>{c.getValue()}</span>
        )
      }),
      col.accessor('approvalPolicy', {
        header: 'Approval',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => {
          const operation = c.row.original
          return (
            <div className="flex flex-wrap gap-2">
              <button className="rm-button inline-flex min-h-8 items-center gap-2 px-2 text-xs" disabled={operationMutation.isPending} onClick={() => void handleToggleOperation(operation)} type="button">
                <Power aria-hidden="true" size={14} />
                <span>{operation.enabled ? 'Disable' : 'Enable'}</span>
              </button>
              <button className="rm-button inline-flex min-h-8 items-center gap-2 px-2 text-xs" disabled={testMutation.isPending} onClick={() => void handleTest(operation)} type="button">
                <FlaskConical aria-hidden="true" size={14} />
                <span>{testMutation.isPending ? 'Testing' : 'Dry run'}</span>
              </button>
              <button className="rm-button inline-flex min-h-8 items-center gap-2 px-2 text-xs" disabled={dispatchMutation.isPending} onClick={() => void handleDispatch(operation)} type="button">
                <Play aria-hidden="true" size={14} />
                <span>{dispatchMutation.isPending ? 'Dispatching' : 'Dispatch'}</span>
              </button>
              {approvalRequests[operation.operationId] !== undefined ? (
                <button className="rm-button inline-flex min-h-8 items-center gap-2 px-2 text-xs" disabled={dispatchMutation.isPending} onClick={() => void handleDispatch(operation, true)} type="button">
                  <CheckCircle aria-hidden="true" size={14} />
                  <span>Approve</span>
                </button>
              ) : null}
            </div>
          )
        }
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [approvalRequests, operationMutation.isPending, testMutation.isPending, dispatchMutation.isPending]
  )

  return (
    <div className="mt-2 grid gap-2">
      <DataTable columns={columns} data={operations} empty="No operations imported." />
      {preview !== undefined ? <ToolOperationTestResult preview={preview} /> : null}
      {Object.entries(dispatchResults).map(([operationId, result]) => (
        <ToolOperationDispatchSummary key={operationId} result={result} />
      ))}
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
    </div>
  )
}

function ToolOperationDispatchSummary({ result }: { result: ToolOperationDispatchResult }) {
  return (
    <div className="mt-2 grid gap-1 rounded-md border border-border p-2 text-muted">
      <div>dispatch: {result.job.status} - HTTP {result.response.status}</div>
      <div>response: {result.response.bodyBytes} bytes{result.response.truncated ? ' truncated' : ''}</div>
      <div>schema: {result.response.schemaValidation.status}{result.response.schemaValidation.errorCode ? ` (${result.response.schemaValidation.errorCode})` : ''}</div>
      <div>host: {result.request.host}</div>
    </div>
  )
}
