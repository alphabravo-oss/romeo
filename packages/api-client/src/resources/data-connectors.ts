import { pathId, withQuery } from '../path'
import type { RomeoTransport } from '../transport'
import type { CreateDataConnectorInput, DataConnector, DataConnectorCatalogReport, DataConnectorSync, SyncDataConnectorInput } from '../types'

export function createDataConnectorResource(transport: RomeoTransport) {
  return {
    list: (workspaceId?: string) => transport.data<DataConnector[]>('GET', withQuery('/api/v1/data-connectors', { workspaceId })),
    catalog: () => transport.data<DataConnectorCatalogReport>('GET', '/api/v1/data-connectors/catalog'),
    create: (input: CreateDataConnectorInput) => transport.data<DataConnector>('POST', '/api/v1/data-connectors', input),
    sync: (input: SyncDataConnectorInput) => {
      const { connectorId, ...body } = input
      return transport.data<DataConnectorSync>('POST', `/api/v1/data-connectors/${pathId(connectorId)}/sync`, body)
    },
    syncs: (connectorId: string) => transport.data<DataConnectorSync[]>('GET', `/api/v1/data-connectors/${pathId(connectorId)}/syncs`)
  }
}
