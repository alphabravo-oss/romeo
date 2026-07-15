import type { ApiErrorEnvelope } from './types'

export class RomeoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiErrorEnvelope
  ) {
    super(message)
    this.name = 'RomeoApiError'
  }
}
