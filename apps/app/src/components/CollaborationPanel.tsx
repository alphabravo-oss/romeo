import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  addFolderItem,
  createFolder,
  favoriteResource,
  listAgentGallery,
  listFavorites,
  listFolderItems,
  listFolders,
  listKnowledgeBases,
  shareAgent,
  shareChat,
  shareFolder,
  shareKnowledgeBase
} from '../api/client'
import { toast } from '../lib/toast'
import type { Agent } from '../api/types'

export function CollaborationPanel({
  activeAgent,
  activeChatId,
  workspaceId
}: {
  activeAgent: Agent | undefined
  activeChatId: string | undefined
  workspaceId: string | undefined
}) {
  const queryClient = useQueryClient()
  const [principalId, setPrincipalId] = useState('group_reviewers')
  const galleryQuery = useQuery({ queryKey: ['agentGallery', workspaceId], queryFn: () => listAgentGallery(workspaceId), enabled: workspaceId !== undefined })
  const favoritesQuery = useQuery({ queryKey: ['favorites'], queryFn: listFavorites })
  const knowledgeBasesQuery = useQuery({
    queryKey: ['knowledgeBases', workspaceId],
    queryFn: () => listKnowledgeBases(workspaceId!),
    enabled: workspaceId !== undefined
  })
  const foldersQuery = useQuery({ queryKey: ['folders', workspaceId], queryFn: () => listFolders(workspaceId!), enabled: workspaceId !== undefined })
  const shareAgentMutation = useMutation({ mutationFn: shareAgent })
  const shareChatMutation = useMutation({ mutationFn: shareChat })
  const shareKnowledgeMutation = useMutation({ mutationFn: shareKnowledgeBase })
  const createFolderMutation = useMutation({ mutationFn: createFolder })
  const shareFolderMutation = useMutation({ mutationFn: shareFolder })
  const addFolderItemMutation = useMutation({ mutationFn: addFolderItem })
  const favoriteMutation = useMutation({ mutationFn: favoriteResource })
  const firstKnowledgeBase = knowledgeBasesQuery.data?.[0]
  const activeFolder = foldersQuery.data?.[0]
  const folderItemsQuery = useQuery({
    queryKey: ['folderItems', activeFolder?.id],
    queryFn: () => listFolderItems(activeFolder!.id),
    enabled: activeFolder !== undefined
  })
  const activeAgentFavorite = (favoritesQuery.data ?? []).find((favorite) => favorite.resourceType === 'agent' && favorite.resourceId === activeAgent?.id)

  async function handleShareAgent() {
    if (!activeAgent) return
    try {
      await shareAgentMutation.mutateAsync({ agentId: activeAgent.id, principalId })
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
      toast('Shared', 'success')
    } catch {
      toast('Could not share agent', 'error')
    }
  }

  async function handleShareKnowledgeBase() {
    if (!firstKnowledgeBase) return
    try {
      await shareKnowledgeMutation.mutateAsync({ knowledgeBaseId: firstKnowledgeBase.id, principalId })
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
      toast('Shared', 'success')
    } catch {
      toast('Could not share knowledge base', 'error')
    }
  }

  async function handleShareChat() {
    if (!activeChatId) return
    try {
      await shareChatMutation.mutateAsync({ chatId: activeChatId, principalId })
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
      toast('Shared', 'success')
    } catch {
      toast('Could not share chat', 'error')
    }
  }

  async function handleFavoriteAgent() {
    if (!activeAgent) return
    try {
      await favoriteMutation.mutateAsync({ resourceType: 'agent', resourceId: activeAgent.id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['favorites'] }),
        queryClient.invalidateQueries({ queryKey: ['agentGallery', workspaceId] })
      ])
      toast('Favorited', 'success')
    } catch {
      toast('Could not favorite agent', 'error')
    }
  }

  async function handleShareFolder() {
    if (!activeFolder) return
    try {
      await shareFolderMutation.mutateAsync({ folderId: activeFolder.id, principalId })
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
      toast('Shared', 'success')
    } catch {
      toast('Could not share folder', 'error')
    }
  }

  async function handleAddFolderItem(resourceType: 'agent' | 'chat' | 'knowledge_base', resourceId: string | undefined) {
    if (!activeFolder || resourceId === undefined) return
    try {
      await addFolderItemMutation.mutateAsync({ folderId: activeFolder.id, resourceType, resourceId })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['folderItems', activeFolder.id] }),
        queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
      ])
      toast('Added', 'success')
    } catch {
      toast('Could not add item', 'error')
    }
  }

  const folderForm = useForm({
    defaultValues: { name: 'Review pack' },
    onSubmit: async ({ value }) => {
      if (!workspaceId) return
      try {
        await createFolderMutation.mutateAsync({ workspaceId, name: value.name.trim() })
        await queryClient.invalidateQueries({ queryKey: ['folders', workspaceId] })
        toast('Folder created', 'success')
      } catch {
        toast('Could not create folder', 'error')
      }
    }
  })

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">Collaboration</div>
      <div className="grid gap-2 text-sm">
        <input className="rm-input" onChange={(event) => setPrincipalId(event.currentTarget.value)} value={principalId} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button className="rm-button" disabled={!activeAgent || shareAgentMutation.isPending} onClick={() => void handleShareAgent()} type="button">
            Share agent
          </button>
          <button className="rm-button" disabled={!activeChatId || shareChatMutation.isPending} onClick={() => void handleShareChat()} type="button">
            Share chat
          </button>
          <button className="rm-button" disabled={!firstKnowledgeBase || shareKnowledgeMutation.isPending} onClick={() => void handleShareKnowledgeBase()} type="button">
            Share KB
          </button>
        </div>
        <button className="rm-button" disabled={!activeAgent || favoriteMutation.isPending || activeAgentFavorite !== undefined} onClick={() => void handleFavoriteAgent()} type="button">
          {activeAgentFavorite ? 'Favorited' : 'Favorite agent'}
        </button>
      </div>
      <form
        className="mt-4 grid gap-2 text-sm"
        data-testid="folder-controls"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void folderForm.handleSubmit()
        }}
      >
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Folders</div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <folderForm.Field
            name="name"
            validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Name is required' : undefined) }}
          >
            {(field) => (
              <>
                <input
                  className="rm-input"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
                ) : null}
              </>
            )}
          </folderForm.Field>
          <folderForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
            {({ canSubmit, isSubmitting }) => (
              <button
                className="rm-button"
                data-testid="folder-create"
                disabled={!canSubmit || isSubmitting || !workspaceId || createFolderMutation.isPending}
                type="submit"
              >
                Create
              </button>
            )}
          </folderForm.Subscribe>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button className="rm-button" data-testid="folder-share" disabled={!activeFolder || shareFolderMutation.isPending} onClick={() => void handleShareFolder()} type="button">
            Share folder
          </button>
          <button
            className="rm-button"
            data-testid="folder-add-chat"
            disabled={!activeFolder || !activeChatId || addFolderItemMutation.isPending}
            onClick={() => void handleAddFolderItem('chat', activeChatId)}
            type="button"
          >
            Add chat
          </button>
          <button
            className="rm-button"
            data-testid="folder-add-agent"
            disabled={!activeFolder || !activeAgent || addFolderItemMutation.isPending}
            onClick={() => void handleAddFolderItem('agent', activeAgent?.id)}
            type="button"
          >
            Add agent
          </button>
          <button
            className="rm-button"
            data-testid="folder-add-kb"
            disabled={!activeFolder || !firstKnowledgeBase || addFolderItemMutation.isPending}
            onClick={() => void handleAddFolderItem('knowledge_base', firstKnowledgeBase?.id)}
            type="button"
          >
            Add KB
          </button>
        </div>
        {activeFolder ? <div className="text-muted">{activeFolder.name}</div> : null}
        <div className="grid gap-2">
          {(folderItemsQuery.data ?? []).slice(0, 4).map((item) => (
            <div className="rounded-md border border-border p-2" key={item.id}>
              <div className="font-medium">{item.resourceType}</div>
              <div className="break-all text-muted">{item.resourceId}</div>
            </div>
          ))}
        </div>
      </form>
      <div className="mt-4 grid gap-2 text-sm">
        {(galleryQuery.data ?? []).slice(0, 4).map((agent) => (
          <div className="rounded-md border border-border p-2" key={agent.id}>
            <div className="font-medium">{agent.name}</div>
            <div className="text-muted">{agent.favorite ? 'favorite' : 'discoverable'}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
