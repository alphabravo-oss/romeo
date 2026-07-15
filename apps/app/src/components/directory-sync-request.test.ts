import { describe, expect, it } from 'vitest'

import { buildDirectorySyncRequest, defaultDirectorySyncForm } from './directory-sync-request'

describe('buildDirectorySyncRequest', () => {
  it('previews with dryRun and no confirmApply', () => {
    const res = buildDirectorySyncRequest(defaultDirectorySyncForm, { apply: false })
    expect(res).toEqual({
      ok: true,
      request: { source: 'scim', preserveAdminUsers: true, dryRun: true }
    })
  })

  it('applies with confirmApply and dryRun:false, same options', () => {
    const res = buildDirectorySyncRequest(
      { ...defaultDirectorySyncForm, disableMissingUsers: true, maxUserDisables: '5' },
      { apply: true }
    )
    expect(res).toEqual({
      ok: true,
      request: {
        source: 'scim',
        preserveAdminUsers: true,
        confirmApply: 'apply-directory-sync',
        dryRun: false,
        disableMissingUsers: true,
        maxUserDisables: 5
      }
    })
  })

  it('parses present emails and rejects malformed ones', () => {
    const ok = buildDirectorySyncRequest(
      { ...defaultDirectorySyncForm, presentUserEmails: 'a@b.com\n c@d.com ' },
      { apply: false }
    )
    expect(ok.ok && ok.request.presentUserEmails).toEqual(['a@b.com', 'c@d.com'])

    const bad = buildDirectorySyncRequest(
      { ...defaultDirectorySyncForm, presentUserEmails: 'not-an-email' },
      { apply: false }
    )
    expect(bad).toEqual({ ok: false, error: 'Invalid email: "not-an-email".' })
  })

  it('parses group memberships (one group per line, ids after the colon)', () => {
    const ok = buildDirectorySyncRequest(
      { ...defaultDirectorySyncForm, groupMemberships: 'g1: u1, u2\ng2: u3\ng3:' },
      { apply: false }
    )
    expect(ok.ok && ok.request.groupMemberships).toEqual([
      { groupId: 'g1', presentUserIds: ['u1', 'u2'] },
      { groupId: 'g2', presentUserIds: ['u3'] },
      { groupId: 'g3', presentUserIds: [] }
    ])
  })

  it('rejects a group line with no group id', () => {
    expect(
      buildDirectorySyncRequest({ ...defaultDirectorySyncForm, groupMemberships: ': u1, u2' }, { apply: false })
    ).toEqual({ ok: false, error: 'Group line is missing a group id: ": u1, u2".' })
  })

  it('rejects out-of-range caps', () => {
    expect(
      buildDirectorySyncRequest({ ...defaultDirectorySyncForm, maxUserDisables: '2000' }, { apply: false })
    ).toEqual({ ok: false, error: 'Max user disables must be a whole number between 0 and 1000.' })
    expect(
      buildDirectorySyncRequest({ ...defaultDirectorySyncForm, maxMembershipRemovals: '-1' }, { apply: false })
    ).toEqual({ ok: false, error: 'Max membership removals must be a whole number between 0 and 10000.' })
  })
})
