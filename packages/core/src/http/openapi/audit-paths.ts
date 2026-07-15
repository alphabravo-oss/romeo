import { arrayEnvelope, errorResponse } from './helpers'
import { auditFilterParameters } from './governance-paths'

export const auditPaths = {
  '/audit-logs': {
    get: {
      summary: 'List audit logs for the caller organization',
      parameters: auditFilterParameters(),
      responses: { 200: arrayEnvelope('Audit log'), 403: errorResponse }
    }
  }
}
