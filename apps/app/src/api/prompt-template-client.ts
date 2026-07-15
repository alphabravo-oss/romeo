import { apiJson } from './http'
import type { Envelope } from './types'
import type {
  CreatePromptTemplateInput,
  PromptTemplate,
  PromptTemplateGrant,
  SharePromptTemplateInput,
  UpdatePromptTemplateInput
} from './prompt-template-types'

export async function listPromptTemplates(workspaceId?: string): Promise<PromptTemplate[]> {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
  const response = await apiJson<Envelope<PromptTemplate[]>>(`/api/v1/prompt-templates${query}`)
  return response.data
}

export async function createPromptTemplate(input: CreatePromptTemplateInput): Promise<PromptTemplate> {
  const response = await apiJson<Envelope<PromptTemplate>>('/api/v1/prompt-templates', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function getPromptTemplate(promptTemplateId: string): Promise<PromptTemplate> {
  const response = await apiJson<Envelope<PromptTemplate>>(
    `/api/v1/prompt-templates/${encodeURIComponent(promptTemplateId)}`
  )
  return response.data
}

export async function updatePromptTemplate(
  promptTemplateId: string,
  input: UpdatePromptTemplateInput
): Promise<PromptTemplate> {
  const response = await apiJson<Envelope<PromptTemplate>>(
    `/api/v1/prompt-templates/${encodeURIComponent(promptTemplateId)}`,
    { method: 'PATCH', body: JSON.stringify(input) }
  )
  return response.data
}

export async function deletePromptTemplate(promptTemplateId: string): Promise<PromptTemplate> {
  const response = await apiJson<Envelope<PromptTemplate>>(
    `/api/v1/prompt-templates/${encodeURIComponent(promptTemplateId)}`,
    { method: 'DELETE' }
  )
  return response.data
}

export async function sharePromptTemplate(
  promptTemplateId: string,
  input: SharePromptTemplateInput
): Promise<PromptTemplateGrant[]> {
  const response = await apiJson<Envelope<PromptTemplateGrant[]>>(
    `/api/v1/prompt-templates/${encodeURIComponent(promptTemplateId)}/shares`,
    { method: 'POST', body: JSON.stringify(input) }
  )
  return response.data
}

export async function listPromptMarketplace(workspaceId?: string): Promise<PromptTemplate[]> {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
  const response = await apiJson<Envelope<PromptTemplate[]>>(`/api/v1/prompt-marketplace${query}`)
  return response.data
}
