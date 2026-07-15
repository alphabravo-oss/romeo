export type PromptTemplateVisibility = 'marketplace' | 'private' | 'workspace'

export interface PromptTemplate {
  id: string
  orgId: string
  workspaceId: string
  name: string
  description?: string
  body: string
  tags: string[]
  visibility: PromptTemplateVisibility
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface CreatePromptTemplateInput {
  workspaceId: string
  name: string
  body: string
  description?: string
  tags?: string[]
  visibility?: PromptTemplateVisibility
}

export interface UpdatePromptTemplateInput {
  name?: string
  body?: string
  description?: string | null
  tags?: string[]
  visibility?: PromptTemplateVisibility
}

export type PromptTemplatePrincipalType = 'group' | 'service_account' | 'user'
export type PromptTemplatePermission = 'read' | 'write' | 'use' | 'run'

export interface SharePromptTemplateInput {
  principalType: PromptTemplatePrincipalType
  principalId: string
  permissions: PromptTemplatePermission[]
}

export interface PromptTemplateGrant {
  id: string
  resourceType: string
  resourceId: string
  principalType: PromptTemplatePrincipalType
  principalId: string
  permission: PromptTemplatePermission
}
