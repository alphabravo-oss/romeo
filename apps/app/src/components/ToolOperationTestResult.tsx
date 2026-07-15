import type { ToolOperationTestPreview } from '../api/types'

export function ToolOperationTestResult({ preview }: { preview: ToolOperationTestPreview }) {
  const keys = [...preview.requestPreview.parameterKeys, ...preview.requestPreview.bodyKeys.map((key) => `body.${key}`)]
  return (
    <div className="mt-2 rounded-md border border-border px-2 py-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{preview.readyForExecution ? 'Ready' : 'Dry run only'}</span>
        <span className="text-muted">{preview.requestPreview.networkExecution}</span>
      </div>
      <div className="break-words text-muted">
        {preview.method.toUpperCase()} {preview.pathTemplate}
      </div>
      <div className="break-words text-muted">
        {preview.disabledReasons.join(', ')}
      </div>
      {keys.length > 0 ? <div className="break-words text-muted">Keys: {keys.join(', ')}</div> : null}
    </div>
  )
}
