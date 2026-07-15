import { apiJson } from './http'
import type { Envelope } from './types'
import type { CreatedDeviceAuthorization, DeviceAuthorization } from './device-types'

export async function listDeviceAuthorizations(): Promise<DeviceAuthorization[]> {
  const response = await apiJson<Envelope<DeviceAuthorization[]>>('/api/v1/device-authorizations')
  return response.data
}

export async function createDeviceAuthorization(input: {
  name: string
  scopes: string[]
  ttlDays?: number
}): Promise<CreatedDeviceAuthorization> {
  const response = await apiJson<Envelope<CreatedDeviceAuthorization>>('/api/v1/device-authorizations', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function revokeDeviceAuthorization(deviceAuthorizationId: string): Promise<DeviceAuthorization> {
  const response = await apiJson<Envelope<DeviceAuthorization>>(
    `/api/v1/device-authorizations/${encodeURIComponent(deviceAuthorizationId)}/revoke`,
    { method: 'POST' }
  )
  return response.data
}
