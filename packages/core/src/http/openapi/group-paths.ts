import { arrayEnvelope, created, errorResponse, jsonContent } from './helpers'

export const groupPaths = {
  '/groups': {
    get: {
      summary: 'List organization groups',
      responses: { 200: arrayEnvelope('Group'), 403: errorResponse }
    },
    post: {
      summary: 'Create an organization group',
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/CreateGroupRequest' }) },
      responses: { 201: created('Group'), 400: errorResponse, 403: errorResponse }
    }
  },
  '/groups/{groupId}/members': {
    get: {
      summary: 'List group memberships',
      parameters: [{ $ref: '#/components/parameters/GroupId' }],
      responses: { 200: arrayEnvelope('Group membership'), 403: errorResponse, 404: errorResponse }
    },
    post: {
      summary: 'Add a user to a group',
      parameters: [{ $ref: '#/components/parameters/GroupId' }],
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/AddGroupMemberRequest' }) },
      responses: { 201: created('Group membership'), 400: errorResponse, 403: errorResponse, 404: errorResponse }
    }
  },
  '/groups/{groupId}/members/{userId}': {
    delete: {
      summary: 'Remove a user from a group',
      parameters: [{ $ref: '#/components/parameters/GroupId' }, { $ref: '#/components/parameters/UserId' }],
      responses: { 200: created('Group membership'), 403: errorResponse, 404: errorResponse }
    }
  }
}
