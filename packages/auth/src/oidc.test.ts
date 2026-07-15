import { describe, expect, it } from 'vitest'

import { extractOidcGroups, mapOidcClaimsToSubject } from './oidc'

describe('OIDC claim mapping', () => {
  it('maps configured groups, workspaces, and admin scopes', () => {
    const subject = mapOidcClaimsToSubject(
      {
        sub: '00u123',
        email: 'admin@example.com',
        name: 'Admin User',
        groups: ['/romeo/admins', '/romeo/reviewers', 'workspace:workspace_finance']
      },
      {
        orgId: 'org_default',
        userId: 'user_oidc_1',
        defaultWorkspaceIds: ['workspace_default'],
        adminGroups: ['/romeo/admins'],
        groupMap: { '/romeo/reviewers': 'group_reviewers' },
        workspaceGroupPrefix: 'workspace:'
      }
    )

    expect(subject.id).toBe('user_oidc_1')
    expect(subject.isAdmin).toBe(true)
    expect(subject.groupIds).toEqual(['group_reviewers', 'group_admins'])
    expect(subject.workspaceIds).toEqual(['workspace_default', 'workspace_finance'])
    expect(subject.scopes).toContain('admin:write')
    expect(subject.oidc).toMatchObject({ subject: '00u123', email: 'admin@example.com', name: 'Admin User' })
  })

  it('extracts Keycloak realm and client roles without granting unmapped groups', () => {
    const groups = extractOidcGroups(
      {
        groups: ['/romeo/users'],
        realm_access: { roles: ['offline_access'] },
        resource_access: { romeo: { roles: ['romeo-admin'] } }
      },
      { clientId: 'romeo' }
    )
    const subject = mapOidcClaimsToSubject(
      {
        sub: 'user-keycloak',
        groups: ['/romeo/users'],
        realm_access: { roles: ['offline_access'] },
        resource_access: { romeo: { roles: ['romeo-admin'] } }
      },
      {
        orgId: 'org_default',
        userId: 'user_keycloak',
        defaultWorkspaceIds: ['workspace_default'],
        clientId: 'romeo',
        adminGroups: ['romeo-admin'],
        groupMap: { '/romeo/users': 'group_users' },
        defaultScopes: ['me:read']
      }
    )

    expect(groups).toEqual(['/romeo/users', 'offline_access', 'romeo-admin'])
    expect(subject.groupIds).toEqual(['group_users', 'group_admins'])
    expect(subject.isAdmin).toBe(true)
  })

  it('rejects missing subject claims', () => {
    expect(() =>
      mapOidcClaimsToSubject(
        { groups: ['/romeo/users'] },
        { orgId: 'org_default', userId: 'user_missing_sub', defaultWorkspaceIds: ['workspace_default'] }
      )
    ).toThrow('sub claim')
  })
})
