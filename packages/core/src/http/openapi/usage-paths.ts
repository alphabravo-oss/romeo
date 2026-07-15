import { arrayEnvelope, errorResponse, success } from './helpers'

export const usagePaths = {
  '/usage/events': {
    get: {
      summary: 'List organization usage events',
      responses: { 200: arrayEnvelope('Usage event'), 403: errorResponse }
    }
  },
  '/usage/events.csv': {
    get: {
      summary: 'Export organization usage events as CSV',
      responses: {
        200: { description: 'Usage events CSV export', content: { 'text/csv': { schema: { type: 'string' } } } },
        403: errorResponse
      }
    }
  },
  '/usage/summary': {
    get: {
      summary: 'Summarize organization usage',
      responses: { 200: success('Usage summary'), 403: errorResponse }
    }
  },
  '/usage/alerts': {
    get: {
      summary: 'List quota usage alerts',
      responses: { 200: arrayEnvelope('Usage alert'), 403: errorResponse }
    }
  }
}
