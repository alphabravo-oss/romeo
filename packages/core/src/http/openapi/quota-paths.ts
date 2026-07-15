import { arrayEnvelope, created, errorResponse, jsonContent, success } from './helpers'

export const quotaPaths = {
  '/quotas': {
    get: {
      summary: 'List quota buckets',
      responses: { 200: arrayEnvelope('Quota bucket'), 403: errorResponse }
    },
    post: {
      summary: 'Create a quota bucket',
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/CreateQuotaBucketRequest' }) },
      responses: { 201: created('Quota bucket'), 400: errorResponse, 403: errorResponse, 409: errorResponse }
    }
  },
  '/quotas/distributed-status': {
    get: {
      summary: 'Get distributed quota coordination status',
      responses: { 200: success('Quota coordination status', { $ref: '#/components/schemas/QuotaCoordinationStatus' }), 403: errorResponse }
    }
  },
  '/quotas/{quotaBucketId}': {
    patch: {
      summary: 'Update a quota bucket',
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/UpdateQuotaBucketRequest' }) },
      responses: { 200: created('Quota bucket'), 400: errorResponse, 403: errorResponse, 404: errorResponse }
    },
    delete: {
      summary: 'Delete a quota bucket',
      responses: { 200: created('Quota bucket'), 403: errorResponse, 404: errorResponse }
    }
  }
}
