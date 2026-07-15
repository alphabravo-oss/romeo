import type { WorkflowStepType } from '../api/workflows-types'
import { STEP_TYPE_OPTIONS, type StepDraft } from './workflow-step-builder'

/**
 * Controlled editor for a workflow's steps. Parent owns the draft array; this
 * renders per-type fields and add/remove/move controls. Validation and step
 * construction live in ./workflow-step-builder (buildWorkflowSteps).
 */
export function WorkflowStepBuilder({
  drafts,
  onChange,
  onAdd
}: {
  drafts: StepDraft[]
  onChange: (drafts: StepDraft[]) => void
  onAdd: () => void
}) {
  function update(index: number, patch: Partial<StepDraft>) {
    onChange(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)))
  }

  function remove(index: number) {
    onChange(drafts.filter((_, i) => i !== index))
  }

  function move(index: number, delta: number) {
    const next = index + delta
    if (next < 0 || next >= drafts.length) return
    const copy = drafts.slice()
    const [item] = copy.splice(index, 1)
    copy.splice(next, 0, item!)
    onChange(copy)
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Steps</div>
        <button className="rm-button" onClick={onAdd} type="button">
          + Add step
        </button>
      </div>
      {drafts.length === 0 ? (
        <div className="rm-empty">No steps yet. Add at least one.</div>
      ) : null}
      {drafts.map((draft, index) => (
        <div className="grid gap-2 border border-border rounded p-3" key={draft.key}>
          <div className="flex items-center gap-2">
            <span className="rm-mono text-xs text-muted">step_{index + 1}</span>
            <select
              className="rm-input"
              onChange={(event) => update(index, { type: event.currentTarget.value as WorkflowStepType })}
              value={draft.type}
            >
              {STEP_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="ml-auto flex gap-1">
              <button className="rm-button" disabled={index === 0} onClick={() => move(index, -1)} type="button" aria-label="Move up">
                ↑
              </button>
              <button
                className="rm-button"
                disabled={index === drafts.length - 1}
                onClick={() => move(index, 1)}
                type="button"
                aria-label="Move down"
              >
                ↓
              </button>
              <button className="rm-button danger" onClick={() => remove(index)} type="button" aria-label="Remove step">
                Remove
              </button>
            </div>
          </div>

          <input
            className="rm-input"
            onChange={(event) => update(index, { name: event.currentTarget.value })}
            placeholder="Step name"
            value={draft.name}
          />

          {draft.type === 'agent_run' || draft.type === 'agent_handoff' ? (
            <input
              className="rm-input"
              onChange={(event) => update(index, { agentId: event.currentTarget.value })}
              placeholder="Agent id"
              value={draft.agentId}
            />
          ) : null}

          {draft.type === 'agent_handoff' ? (
            <>
              <select
                className="rm-input"
                onChange={(event) => update(index, { handoffFromStepId: event.currentTarget.value })}
                value={draft.handoffFromStepId}
              >
                <option value="">Hand off from previous step (default)</option>
                {drafts.slice(0, index).map((_, earlier) => (
                  <option key={earlier} value={`step_${earlier + 1}`}>
                    step_{earlier + 1}
                  </option>
                ))}
              </select>
              <input
                className="rm-input"
                onChange={(event) => update(index, { handoffPrompt: event.currentTarget.value })}
                placeholder="Handoff prompt (optional)"
                value={draft.handoffPrompt}
              />
            </>
          ) : null}

          {draft.type === 'agent_room' ? (
            <>
              <textarea
                className="rm-input"
                onChange={(event) => update(index, { agentIds: event.currentTarget.value })}
                placeholder="Agent ids — 2 to 5, one per line or comma-separated"
                rows={2}
                value={draft.agentIds}
              />
              <input
                className="rm-input"
                onChange={(event) => update(index, { roomPrompt: event.currentTarget.value })}
                placeholder="Room prompt (optional)"
                value={draft.roomPrompt}
              />
            </>
          ) : null}

          {draft.type === 'approval' ? (
            <input
              className="rm-input"
              onChange={(event) => update(index, { approvalPrompt: event.currentTarget.value })}
              placeholder="Approval prompt (optional)"
              value={draft.approvalPrompt}
            />
          ) : null}

          {draft.type === 'tool_approval' ? (
            <>
              <input
                className="rm-input"
                onChange={(event) => update(index, { toolChainName: event.currentTarget.value })}
                placeholder="Tool chain name (optional)"
                value={draft.toolChainName}
              />
              <select
                className="rm-input"
                onChange={(event) => update(index, { riskLevel: event.currentTarget.value as StepDraft['riskLevel'] })}
                value={draft.riskLevel}
              >
                <option value="">Risk level (optional)</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <input
                className="rm-input"
                onChange={(event) => update(index, { inputKeys: event.currentTarget.value })}
                placeholder="Input keys (optional, comma-separated)"
                value={draft.inputKeys}
              />
              <input
                className="rm-input"
                onChange={(event) => update(index, { approvalPrompt: event.currentTarget.value })}
                placeholder="Approval prompt (optional)"
                value={draft.approvalPrompt}
              />
            </>
          ) : null}

          {draft.type === 'browser_task' ? (
            <>
              <input
                className="rm-input"
                onChange={(event) => update(index, { targetUrl: event.currentTarget.value })}
                placeholder="Target URL (https://…)"
                value={draft.targetUrl}
              />
              <input
                className="rm-input"
                onChange={(event) => update(index, { task: event.currentTarget.value })}
                placeholder="Task description"
                value={draft.task}
              />
              <input
                className="rm-input"
                onChange={(event) => update(index, { approvalPrompt: event.currentTarget.value })}
                placeholder="Approval prompt (optional)"
                value={draft.approvalPrompt}
              />
            </>
          ) : null}

          {draft.type === 'notification' ? (
            <input
              className="rm-input"
              onChange={(event) => update(index, { message: event.currentTarget.value })}
              placeholder="Message (optional)"
              value={draft.message}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}
