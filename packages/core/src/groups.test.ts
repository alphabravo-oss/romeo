import { describe, expect, it } from 'vitest'
import { createApiKeyToken, hashApiKey } from '@romeo/auth'
import { readEnv } from '@romeo/config'

import { createRomeoApi } from './api'
import { InMemoryRomeoRepository } from './repositories/in-memory'

describe('group administration', () => {
  it('creates groups, manages memberships, exposes durable share targets, and authenticates member group IDs', async () => {
    const repository = new InMemoryRomeoRepository()
    await repository.createUser({ id: 'user_reviewer', orgId: 'org_default', email: 'reviewer@romeo.local', name: 'Reviewer User' })
    const api = createRomeoApi(repository)

    const groupResponse = await api.request('/api/v1/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Reviewers', slug: 'reviewers' })
    })
    const group = await groupResponse.json()
    const addResponse = await api.request(`/api/v1/groups/${group.data.id}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user_reviewer' })
    })
    const added = await addResponse.json()
    const memberListResponse = await api.request(`/api/v1/groups/${group.data.id}/members`)
    const memberList = await memberListResponse.json()
    const shareTargetsResponse = await api.request('/api/v1/share-targets?query=reviewers')
    const shareTargets = await shareTargetsResponse.json()

    const token = createApiKeyToken()
    await repository.createApiKey({
      id: 'api_key_reviewer',
      orgId: 'org_default',
      userId: 'user_reviewer',
      name: 'Reviewer API key',
      hashedToken: await hashApiKey(token),
      scopes: ['me:read'],
      createdAt: new Date().toISOString()
    })
    const secureApi = createRomeoApi(repository, {
      env: readEnv({
        DEV_SEEDED_LOGIN: 'false',
        SESSION_SECRET: 'prod-session-secret-32-bytes-long',
        WEBHOOK_SIGNING_KEY: 'prod-webhook-signing-key-32-bytes'
      })
    })
    const meResponse = await secureApi.request('/api/v1/me', {
      headers: { authorization: `Bearer ${token}` }
    })
    const me = await meResponse.json()
    const removeResponse = await api.request(`/api/v1/groups/${group.data.id}/members/user_reviewer`, { method: 'DELETE' })
    const removed = await removeResponse.json()
    const auditResponse = await api.request('/api/v1/audit-logs?action=group.member.add')
    const audit = await auditResponse.json()

    expect(groupResponse.status).toBe(201)
    expect(group.data).toMatchObject({ id: 'group_reviewers', name: 'Reviewers', slug: 'reviewers' })
    expect(addResponse.status).toBe(201)
    expect(added.data).toMatchObject({ groupId: 'group_reviewers', userId: 'user_reviewer', orgId: 'org_default' })
    expect(memberListResponse.status).toBe(200)
    expect(memberList.data).toHaveLength(1)
    expect(shareTargets.data).toContainEqual({ principalType: 'group', principalId: 'group_reviewers', label: 'Reviewers' })
    expect(meResponse.status).toBe(200)
    expect(me.subject.groupIds).toContain('group_reviewers')
    expect(removeResponse.status).toBe(200)
    expect(removed.data.userId).toBe('user_reviewer')
    expect(audit.data[0]).toMatchObject({
      action: 'group.member.add',
      resourceId: 'group_reviewers',
      metadata: { userId: 'user_reviewer' }
    })
    expect(JSON.stringify(audit.data)).not.toContain('reviewer@romeo.local')
  })
})
