import type { RunEvent, RunEventType } from '@romeo/ai-runtime'

import type { RomeoRepository } from '../domain/repository'

export class RunEventSequencer {
  private readonly lastSequence = new Map<string, number>()

  async assign(repository: RomeoRepository, event: RunEvent): Promise<RunEvent> {
    const sequence = await this.next(repository, event.runId)
    return { ...event, id: `evt_${event.runId}_${sequence}`, sequence }
  }

  async create(
    repository: RomeoRepository,
    input: { runId: string; type: RunEventType; data: Record<string, unknown> }
  ): Promise<RunEvent> {
    const sequence = await this.next(repository, input.runId)
    return {
      id: `evt_${input.runId}_${sequence}`,
      runId: input.runId,
      sequence,
      type: input.type,
      data: input.data,
      createdAt: new Date().toISOString()
    }
  }

  private async next(repository: RomeoRepository, runId: string): Promise<number> {
    const known = this.lastSequence.get(runId)
    const maxPersisted = known ?? Math.max(0, ...(await repository.listRunEvents(runId)).map((event) => event.sequence))
    const next = maxPersisted + 1
    this.lastSequence.set(runId, next)
    return next
  }
}
