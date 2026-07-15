import { apiJson } from './http'
import type {
  AbuseControlPolicyReport,
  EdgeSecurityPostureReport,
  UpdateAbuseControlPolicyRequest
} from './abuse-controls-types'
import type { Envelope } from './types'

export async function getAbuseControls(): Promise<AbuseControlPolicyReport> {
  const response = await apiJson<Envelope<AbuseControlPolicyReport>>(
    '/api/v1/admin/abuse-controls'
  )
  return response.data
}

export async function updateAbuseControls(
  input: UpdateAbuseControlPolicyRequest
): Promise<AbuseControlPolicyReport> {
  const response = await apiJson<Envelope<AbuseControlPolicyReport>>(
    '/api/v1/admin/abuse-controls',
    {
      method: 'PATCH',
      body: JSON.stringify(input)
    }
  )
  return response.data
}

export async function getEdgeSecurityPosture(): Promise<EdgeSecurityPostureReport> {
  const response = await apiJson<Envelope<EdgeSecurityPostureReport>>(
    '/api/v1/admin/edge-security/posture'
  )
  return response.data
}
