import { apiJson } from './http'
import type { DataConnector, DataConnectorCatalogReport, DataConnectorSync, DataConnectorType, Envelope } from './types'

export async function getDataConnectorCatalog(): Promise<DataConnectorCatalogReport> {
  const response = await apiJson<Envelope<DataConnectorCatalogReport>>('/api/v1/data-connectors/catalog')
  return response.data
}

export async function createDataConnector(input: {
  workspaceId: string
  knowledgeBaseId: string
  type: DataConnectorType
  name: string
  syncIntervalMinutes?: number
  config?: Record<string, unknown>
}): Promise<DataConnector> {
  const response = await apiJson<Envelope<DataConnector>>('/api/v1/data-connectors', {
    method: 'POST',
    body: JSON.stringify({ ...input, config: input.config ?? {} })
  })
  return response.data
}

export async function listDataConnectors(workspaceId: string): Promise<DataConnector[]> {
  const response = await apiJson<Envelope<DataConnector[]>>(`/api/v1/data-connectors?workspaceId=${encodeURIComponent(workspaceId)}`)
  return response.data
}

export async function createLocalDataConnector(input: { workspaceId: string; knowledgeBaseId: string; name: string }): Promise<DataConnector> {
  const response = await apiJson<Envelope<DataConnector>>('/api/v1/data-connectors', {
    method: 'POST',
    body: JSON.stringify({ ...input, type: 'local_import', config: {} })
  })
  return response.data
}

export async function syncLocalDataConnector(input: {
  connectorId: string
  fileName: string
  mimeType: string
  content: string
}): Promise<DataConnectorSync> {
  const response = await apiJson<Envelope<DataConnectorSync>>(`/api/v1/data-connectors/${encodeURIComponent(input.connectorId)}/sync`, {
    method: 'POST',
    body: JSON.stringify({
      items: [
        {
          fileName: input.fileName,
          mimeType: input.mimeType,
          content: input.content,
          sizeBytes: new TextEncoder().encode(input.content).length
        }
      ]
    })
  })
  return response.data
}

export async function listDataConnectorSyncs(connectorId: string): Promise<DataConnectorSync[]> {
  const response = await apiJson<Envelope<DataConnectorSync[]>>(`/api/v1/data-connectors/${encodeURIComponent(connectorId)}/syncs`)
  return response.data
}
