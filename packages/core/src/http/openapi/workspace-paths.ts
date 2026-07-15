import { errorResponse, success } from './helpers'

export const workspacePaths = {
  '/workspaces/{workspaceId}/archive': {
    post: {
      summary: 'Archive a workspace',
      parameters: [{ $ref: '#/components/parameters/WorkspaceId' }],
      responses: { 200: success('Workspace'), 403: errorResponse, 404: errorResponse }
    }
  },
  '/workspaces/{workspaceId}/export': {
    get: {
      summary: 'Export a sanitized workspace data inventory',
      parameters: [{ $ref: '#/components/parameters/WorkspaceId' }],
      responses: { 200: success('Workspace export document'), 403: errorResponse, 404: errorResponse }
    }
  }
}
