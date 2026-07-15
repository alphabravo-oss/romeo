import { describe, expect, it } from 'vitest'
import type { AuthSubject } from '@romeo/auth'

import { createRomeoApi } from './api'
import { InMemoryRomeoRepository } from './repositories/in-memory'
import { PromptTemplateService } from './services/prompt-template-service'

describe('Prompt template sharing', () => {
  it('keeps private prompts hidden until shared and exposes marketplace prompts without leaking bodies in audit logs', async () => {
    const repository = new InMemoryRomeoRepository()
    const service = new PromptTemplateService(repository)
    const owner: AuthSubject = {
      id: 'user_prompt_owner',
      type: 'user',
      orgId: 'org_default',
      workspaceIds: ['workspace_default'],
      groupIds: [],
      scopes: ['agents:read', 'agents:write']
    }
    const viewer: AuthSubject = {
      id: 'user_prompt_viewer',
      type: 'user',
      orgId: 'org_default',
      workspaceIds: ['workspace_default'],
      groupIds: [],
      scopes: ['agents:read']
    }

    const privatePrompt = await service.create(owner, {
      workspaceId: 'workspace_default',
      name: 'Incident responder',
      body: 'Private prompt body should not appear in audit logs.',
      tags: ['Ops', 'IR']
    })
    const hiddenList = await service.list(viewer, 'workspace_default')

    await service.share({
      subject: owner,
      promptTemplateId: privatePrompt.id,
      share: { principalType: 'user', principalId: viewer.id, permissions: ['read', 'use'] }
    })
    const sharedList = await service.list(viewer, 'workspace_default')
    const marketplacePrompt = await service.create(owner, {
      workspaceId: 'workspace_default',
      name: 'Launch summary',
      body: 'Marketplace prompt body should not appear in audit logs.',
      visibility: 'marketplace',
      tags: ['launch']
    })
    const marketplace = await service.marketplace(viewer, 'workspace_default', 'launch')
    const auditLogs = await repository.listAuditLogs('org_default')

    expect(hiddenList).toHaveLength(0)
    expect(sharedList.map((prompt) => prompt.id)).toContain(privatePrompt.id)
    expect(marketplace.map((prompt) => prompt.id)).toEqual([marketplacePrompt.id])
    expect(privatePrompt.tags).toEqual(['ops', 'ir'])
    expect(auditLogs.some((log) => log.action === 'prompt_template.share' && log.resourceId === privatePrompt.id)).toBe(true)
    expect(JSON.stringify(auditLogs)).not.toContain('Private prompt body')
    expect(JSON.stringify(auditLogs)).not.toContain('Marketplace prompt body')
  })

  it('exposes prompt-template API paths in OpenAPI', async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository())
    const specResponse = await api.request('/api/v1/openapi.json')
    const spec = await specResponse.json()

    expect(Object.keys(spec.paths)).toContain('/prompt-templates')
    expect(Object.keys(spec.paths)).toContain('/prompt-marketplace')
    expect(Object.keys(spec.paths)).toContain('/prompt-templates/{promptTemplateId}/shares')
  })
})
