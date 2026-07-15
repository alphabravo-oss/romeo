import { apiJson } from './http'
import type { Envelope } from './types'
import type { Group, GroupMember } from './groups-types'

export async function listGroups(): Promise<Group[]> {
  const response = await apiJson<Envelope<Group[]>>('/api/v1/groups')
  return response.data
}

export async function createGroup(input: { name: string; slug?: string }): Promise<Group> {
  const body: { name: string; slug?: string } = { name: input.name }
  if (input.slug !== undefined && input.slug.trim() !== '') body.slug = input.slug
  const response = await apiJson<Envelope<Group>>('/api/v1/groups', {
    method: 'POST',
    body: JSON.stringify(body)
  })
  return response.data
}

export async function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  const response = await apiJson<Envelope<GroupMember[]>>(`/api/v1/groups/${encodeURIComponent(groupId)}/members`)
  return response.data
}

export async function addGroupMember(input: { groupId: string; userId: string }): Promise<GroupMember> {
  const response = await apiJson<Envelope<GroupMember>>(`/api/v1/groups/${encodeURIComponent(input.groupId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId: input.userId })
  })
  return response.data
}

export async function removeGroupMember(input: { groupId: string; userId: string }): Promise<GroupMember> {
  const response = await apiJson<Envelope<GroupMember>>(
    `/api/v1/groups/${encodeURIComponent(input.groupId)}/members/${encodeURIComponent(input.userId)}`,
    { method: 'DELETE' }
  )
  return response.data
}
