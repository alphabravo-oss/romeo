import { arrayEnvelope, created, errorResponse, jsonContent, success } from './helpers'

export const workflowPaths = {
  '/workflow-templates': {
    get: {
      summary: 'List safe workflow templates',
      responses: { 200: arrayEnvelope('Workflow template'), 403: errorResponse }
    }
  },
  '/workflow-templates/{templateId}/create': {
    post: {
      summary: 'Create a workflow definition from a safe template',
      parameters: [{ name: 'templateId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/CreateWorkflowFromTemplateRequest' }) },
      responses: { 201: created('Workflow definition'), 400: errorResponse, 403: errorResponse, 404: errorResponse }
    }
  },
  '/workflows': {
    get: {
      summary: 'List workflow definitions',
      parameters: [{ name: 'workspaceId', in: 'query', required: false, schema: { type: 'string' } }],
      responses: { 200: arrayEnvelope('Workflow definition'), 403: errorResponse }
    },
    post: {
      summary: 'Create a safe workflow definition',
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/CreateWorkflowRequest' }) },
      responses: { 201: created('Workflow definition'), 400: errorResponse, 403: errorResponse }
    }
  },
  '/workflows/{workflowId}/runs': {
    get: {
      summary: 'List workflow runs',
      parameters: [{ name: 'workflowId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: arrayEnvelope('Workflow run'), 403: errorResponse, 404: errorResponse }
    },
    post: {
      summary: 'Start a workflow run',
      parameters: [{ name: 'workflowId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: false, content: jsonContent({ $ref: '#/components/schemas/StartWorkflowRunRequest' }) },
      responses: { 201: created('Workflow run'), 400: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse }
    }
  },
  '/workflows/schedules/run-due': {
    post: {
      summary: 'Start due scheduled workflows visible to the caller',
      responses: { 200: success('Workflow schedule run result'), 403: errorResponse, 409: errorResponse }
    }
  },
  '/workflow-runs/{workflowRunId}/approve': {
    post: {
      summary: 'Approve a waiting workflow run',
      parameters: [{ name: 'workflowRunId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: false, content: jsonContent({ $ref: '#/components/schemas/ApproveWorkflowRunRequest' }) },
      responses: { 200: success('Workflow run'), 400: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse }
    }
  },
  '/workflow-runs/{workflowRunId}/resume': {
    post: {
      summary: 'Resume a workflow run waiting for a linked model run',
      parameters: [{ name: 'workflowRunId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: success('Workflow run'), 403: errorResponse, 404: errorResponse, 409: errorResponse }
    }
  }
}
