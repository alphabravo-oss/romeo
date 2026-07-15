import { apiJson } from './http'
import type { Envelope } from './types'
import type { Organization } from './organizations-types'

export async function listOrganizations(): Promise<Organization[]> {
  const response = await apiJson<Envelope<Organization[]>>('/api/v1/organizations')
  return response.data
}
