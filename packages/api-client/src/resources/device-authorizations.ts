import { pathId } from '../path'
import type { RomeoTransport } from '../transport'
import type { CreateDeviceAuthorizationInput, CreatedDeviceAuthorization, DeviceAuthorization } from '../types'

export function createDeviceAuthorizationResource(transport: RomeoTransport) {
  return {
    list: () => transport.data<DeviceAuthorization[]>('GET', '/api/v1/device-authorizations'),
    create: (input: CreateDeviceAuthorizationInput) => transport.data<CreatedDeviceAuthorization>('POST', '/api/v1/device-authorizations', input),
    refresh: (refreshToken: string) =>
      transport.data<CreatedDeviceAuthorization>('POST', '/api/v1/device-authorizations/refresh', { refreshToken }),
    revoke: (deviceAuthorizationId: string) =>
      transport.data<DeviceAuthorization>('POST', `/api/v1/device-authorizations/${pathId(deviceAuthorizationId)}/revoke`)
  }
}

