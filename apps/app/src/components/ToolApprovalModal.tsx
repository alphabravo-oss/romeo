import Check from 'lucide-react/dist/esm/icons/check.mjs'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.mjs'
import X from 'lucide-react/dist/esm/icons/x.mjs'

import { useFocusTrap } from '../lib/use-focus-trap'
import type { PendingToolApproval } from './useToolExecution'

export function ToolApprovalModal({
  approval,
  isExecuting,
  onApprove,
  onCancel
}: {
  approval: PendingToolApproval
  isExecuting: boolean
  onApprove: () => void
  onCancel: () => void
}) {
  const dialogRef = useFocusTrap({ active: true, onEscape: onCancel })
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="presentation">
      <div aria-labelledby="tool-approval-title" aria-modal="true" className="rm-panel w-full max-w-sm p-4 shadow-xl" ref={dialogRef} role="dialog">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" size={18} />
          <div className="font-medium" id="tool-approval-title">{approval.name}</div>
        </div>
        <div className="mt-3 grid gap-1 text-sm text-muted">
          <div>Risk: {approval.riskLevel}</div>
          <div>Policy: {approval.approvalPolicy}</div>
          <div>Input keys: {approval.inputKeys.join(', ') || 'none'}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="rm-button inline-flex items-center justify-center gap-2" onClick={onCancel} type="button">
            <X aria-hidden="true" size={16} />
            <span>Cancel</span>
          </button>
          <button className="rm-button primary inline-flex items-center justify-center gap-2" disabled={isExecuting} onClick={onApprove} type="button">
            <Check aria-hidden="true" size={16} />
            <span>{isExecuting ? 'Approving' : 'Approve'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
