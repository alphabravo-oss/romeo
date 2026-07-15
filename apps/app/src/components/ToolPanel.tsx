import { useForm } from '@tanstack/react-form'
import Calculator from 'lucide-react/dist/esm/icons/calculator.mjs'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.mjs'
import type { FormEvent } from 'react'

import type { AgentToolSummary } from '../api/types'
import { toast } from '../lib/toast'
import { ToolApprovalModal } from './ToolApprovalModal'
import type { PendingToolApproval } from './useToolExecution'

export function ToolPanel({
  isExecuting,
  onExecuteCalculator,
  onApproveTool,
  onCancelToolApproval,
  onExecuteDateTime,
  pendingApproval,
  result,
  tools
}: {
  isExecuting: boolean
  onExecuteCalculator: (expression: string) => void
  onApproveTool: () => void
  onCancelToolApproval: () => void
  onExecuteDateTime: () => void
  pendingApproval: PendingToolApproval | undefined
  result: string | undefined
  tools: AgentToolSummary[]
}) {
  const calculator = tools.find((tool) => tool.id === 'tool_calculator')
  const dateTime = tools.find((tool) => tool.id === 'tool_datetime')
  const canRunCalculator = isCallable(calculator)
  const canRunDateTime = isCallable(dateTime)

  const calculatorForm = useForm({
    defaultValues: { expression: '2 + 3 * 4' },
    onSubmit: async ({ value }) => {
      try {
        onExecuteCalculator(value.expression)
        toast('Calculator run', 'success')
      } catch {
        toast('Could not run calculator', 'error')
      }
    }
  })

  function handleDateTimeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      onExecuteDateTime()
      toast('Date/time run', 'success')
    } catch {
      toast('Could not run date/time', 'error')
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">Tools</div>
      <div className="grid gap-2 text-sm">
        {tools.map((tool) => (
          <div className="rounded-md border border-border p-3" key={tool.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{tool.name}</div>
              <div className="text-xs text-muted">{toolState(tool)}</div>
            </div>
            <div className="text-muted">{tool.riskLevel} risk</div>
          </div>
        ))}
      </div>
      <form
        className="mt-4 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void calculatorForm.handleSubmit()
        }}
      >
        <label className="text-sm text-muted" htmlFor="calculator-expression">
          Calculator
        </label>
        <calculatorForm.Field
          name="expression"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Expression is required' : undefined) }}
        >
          {(field) => (
            <>
              <input
                className="rm-input"
                id="calculator-expression"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </calculatorForm.Field>
        <calculatorForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button
              className="rm-button inline-flex items-center justify-center gap-2"
              disabled={!canSubmit || isSubmitting || isExecuting || !canRunCalculator}
              type="submit"
            >
              <Calculator aria-hidden="true" size={16} />
              <span>{isExecuting ? 'Running' : 'Run calculator'}</span>
            </button>
          )}
        </calculatorForm.Subscribe>
      </form>
      <form className="mt-4 grid gap-2" onSubmit={handleDateTimeSubmit}>
        <button className="rm-button inline-flex items-center justify-center gap-2" disabled={isExecuting || !canRunDateTime} type="submit">
          <Clock3 aria-hidden="true" size={16} />
          <span>{isExecuting ? 'Running' : 'Run date/time'}</span>
        </button>
      </form>
      {result ? <div className="mt-3 rounded-md border border-border p-3 text-sm">{result}</div> : null}
      {pendingApproval ? (
        <ToolApprovalModal approval={pendingApproval} isExecuting={isExecuting} onApprove={onApproveTool} onCancel={onCancelToolApproval} />
      ) : null}
    </section>
  )
}

function isCallable(tool: AgentToolSummary | undefined): boolean {
  return tool?.bound === true && tool.enabled && tool.hasAccess
}

function toolState(tool: AgentToolSummary): string {
  if (!tool.hasAccess) return 'No access'
  if (!tool.bound) return 'Not bound'
  if (!tool.enabled) return 'Disabled'
  return tool.approvalRequired ? 'Approval required' : 'Enabled'
}
