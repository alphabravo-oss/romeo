import type { RagProvider, RetrievalHit, RetrievalQuery } from './types'

export class DisabledRagProvider implements RagProvider {
  async retrieve(_query: RetrievalQuery): Promise<RetrievalHit[]> {
    return []
  }
}

export const disabledRagProvider = new DisabledRagProvider()
