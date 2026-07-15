import type { Workspace } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'
import { ApiError, notFound } from '../errors'

export async function getActiveWorkspace(
  repository: RomeoRepository,
  input: { orgId: string; workspaceId: string }
): Promise<Workspace> {
  const workspace = await repository.getWorkspace(input.workspaceId)
  if (!workspace || workspace.orgId !== input.orgId) throw notFound('Workspace')
  if (workspace.archivedAt !== undefined) {
    throw new ApiError('workspace_archived', 'Archived workspaces cannot accept new resources.', 409)
  }
  return workspace
}

export async function assertWorkspaceActive(
  repository: RomeoRepository,
  input: { orgId: string; workspaceId: string }
): Promise<void> {
  await getActiveWorkspace(repository, input)
}
