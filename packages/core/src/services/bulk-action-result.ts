import { ApiError } from '../errors'

export interface BulkActionItemResult {
  id: string
  status: 'success' | 'failure'
  error?: string
}

export interface BulkActionResult {
  results: BulkActionItemResult[]
}

export function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

export function bulkErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Unknown error.'
}
