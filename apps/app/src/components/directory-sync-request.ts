// Pure builder for the directory-sync request. Preview and apply send the SAME
// options — only dryRun/confirmApply differ — so the applied plan matches the
// preview the admin approved. Mirrors packages/core directorySyncSchema.

import type {
  DirectorySyncGroupInventory,
  DirectorySyncRequest,
  DirectorySyncSource
} from '../api/auth-provider-types'

export interface DirectorySyncForm {
  source: DirectorySyncSource
  reason: string
  presentUserEmails: string // comma/newline separated
  groupMemberships: string // one group per line: "groupId: userId1, userId2"
  disableMissingUsers: boolean
  removeMissingGroupMembers: boolean
  preserveAdminUsers: boolean
  allowAdminUserDisable: boolean
  maxUserDisables: string // numeric text, optional
  maxMembershipRemovals: string // numeric text, optional
}

export const defaultDirectorySyncForm: DirectorySyncForm = {
  source: 'scim',
  reason: '',
  presentUserEmails: '',
  groupMemberships: '',
  disableMissingUsers: false,
  removeMissingGroupMembers: false,
  preserveAdminUsers: true,
  allowAdminUserDisable: false,
  maxUserDisables: '',
  maxMembershipRemovals: ''
}

export const DIRECTORY_SYNC_SOURCES: DirectorySyncSource[] = [
  'scim',
  'active-directory',
  'ldap',
  'oidc',
  'saml',
  'manual'
]

export type BuildRequestResult =
  | { ok: true; request: DirectorySyncRequest }
  | { ok: false; error: string }

function tokens(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

/**
 * Parse the group-inventory textarea. Each non-empty line is one group:
 * "groupId: userId1, userId2 …" (ids comma/space separated). The group id is
 * everything before the first colon, so it can't itself contain a colon.
 */
function parseGroupMemberships(
  text: string
): { value?: DirectorySyncGroupInventory[]; error?: string } {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return {}
  if (lines.length > 500) return { error: 'At most 500 groups.' }

  const groups: DirectorySyncGroupInventory[] = []
  for (const line of lines) {
    const colon = line.indexOf(':')
    const groupId = (colon === -1 ? line : line.slice(0, colon)).trim()
    if (!groupId) return { error: `Group line is missing a group id: "${line}".` }
    if (groupId.length > 120) return { error: `Group id is too long (max 120): "${groupId}".` }

    const rest = colon === -1 ? '' : line.slice(colon + 1)
    const presentUserIds = rest
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
    for (const userId of presentUserIds) {
      if (userId.length > 120) return { error: `User id is too long (max 120) in group "${groupId}".` }
    }
    if (presentUserIds.length > 10_000) {
      return { error: `Group "${groupId}" has too many user ids (max 10000).` }
    }
    groups.push({ groupId, presentUserIds })
  }
  return { value: groups }
}

function parseCap(text: string, max: number, label: string): { value?: number; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) return {}
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 0 || n > max) {
    return { error: `${label} must be a whole number between 0 and ${max}.` }
  }
  return { value: n }
}

export function buildDirectorySyncRequest(
  form: DirectorySyncForm,
  opts: { apply: boolean }
): BuildRequestResult {
  const emails = tokens(form.presentUserEmails)
  for (const email of emails) {
    if (!email.includes('@')) return { ok: false, error: `Invalid email: "${email}".` }
  }

  const userCap = parseCap(form.maxUserDisables, 1_000, 'Max user disables')
  if (userCap.error) return { ok: false, error: userCap.error }
  const removalCap = parseCap(form.maxMembershipRemovals, 10_000, 'Max membership removals')
  if (removalCap.error) return { ok: false, error: removalCap.error }

  const groups = parseGroupMemberships(form.groupMemberships)
  if (groups.error) return { ok: false, error: groups.error }

  const reason = form.reason.trim()

  const request: DirectorySyncRequest = {
    source: form.source,
    preserveAdminUsers: form.preserveAdminUsers,
    ...(opts.apply ? { confirmApply: 'apply-directory-sync', dryRun: false } : { dryRun: true }),
    ...(reason ? { reason } : {}),
    ...(emails.length ? { presentUserEmails: emails } : {}),
    ...(groups.value && groups.value.length ? { groupMemberships: groups.value } : {}),
    ...(form.disableMissingUsers ? { disableMissingUsers: true } : {}),
    ...(form.removeMissingGroupMembers ? { removeMissingGroupMembers: true } : {}),
    ...(form.allowAdminUserDisable ? { allowAdminUserDisable: true } : {}),
    ...(userCap.value !== undefined ? { maxUserDisables: userCap.value } : {}),
    ...(removalCap.value !== undefined ? { maxMembershipRemovals: removalCap.value } : {})
  }

  return { ok: true, request }
}
