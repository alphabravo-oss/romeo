import { pathId, withQuery } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  AgentGalleryItem,
  CreateFavoriteInput,
  CreateFolderInput,
  CreateFolderItemInput,
  CreatePromptTemplateInput,
  PromptTemplate,
  ResourceFavorite,
  ResourceGrant,
  ShareResourceInput,
  ShareTarget,
  UpdatePromptTemplateInput,
  UpdateFolderInput,
  WorkspaceFolder,
  WorkspaceFolderItem,
} from "../types";

export function createCollaborationResource(transport: RomeoTransport) {
  return {
    shareTargets: (query?: string, limit?: number) =>
      transport.data<ShareTarget[]>(
        "GET",
        withQuery("/api/v1/share-targets", { query, limit }),
      ),
    promptTemplates: (workspaceId: string, query?: string) =>
      transport.data<PromptTemplate[]>(
        "GET",
        withQuery("/api/v1/prompt-templates", { workspaceId, query }),
      ),
    promptMarketplace: (workspaceId: string, query?: string) =>
      transport.data<PromptTemplate[]>(
        "GET",
        withQuery("/api/v1/prompt-marketplace", { workspaceId, query }),
      ),
    createPromptTemplate: (input: CreatePromptTemplateInput) =>
      transport.data<PromptTemplate>("POST", "/api/v1/prompt-templates", input),
    promptTemplate: (promptTemplateId: string) =>
      transport.data<PromptTemplate>(
        "GET",
        `/api/v1/prompt-templates/${pathId(promptTemplateId)}`,
      ),
    updatePromptTemplate: (
      promptTemplateId: string,
      input: UpdatePromptTemplateInput,
    ) =>
      transport.data<PromptTemplate>(
        "PATCH",
        `/api/v1/prompt-templates/${pathId(promptTemplateId)}`,
        input,
      ),
    deletePromptTemplate: (promptTemplateId: string) =>
      transport.data<PromptTemplate>(
        "DELETE",
        `/api/v1/prompt-templates/${pathId(promptTemplateId)}`,
      ),
    promptTemplateShares: (promptTemplateId: string) =>
      transport.data<ResourceGrant[]>(
        "GET",
        `/api/v1/prompt-templates/${pathId(promptTemplateId)}/shares`,
      ),
    sharePromptTemplate: (
      promptTemplateId: string,
      input: ShareResourceInput,
    ) =>
      transport.data<ResourceGrant[]>(
        "POST",
        `/api/v1/prompt-templates/${pathId(promptTemplateId)}/shares`,
        input,
      ),
    agentShares: (agentId: string) =>
      transport.data<ResourceGrant[]>(
        "GET",
        `/api/v1/agents/${pathId(agentId)}/shares`,
      ),
    shareAgent: (agentId: string, input: ShareResourceInput) =>
      transport.data<ResourceGrant[]>(
        "POST",
        `/api/v1/agents/${pathId(agentId)}/shares`,
        input,
      ),
    knowledgeBaseShares: (knowledgeBaseId: string) =>
      transport.data<ResourceGrant[]>(
        "GET",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/shares`,
      ),
    shareKnowledgeBase: (knowledgeBaseId: string, input: ShareResourceInput) =>
      transport.data<ResourceGrant[]>(
        "POST",
        `/api/v1/knowledge-bases/${pathId(knowledgeBaseId)}/shares`,
        input,
      ),
    chatShares: (chatId: string) =>
      transport.data<ResourceGrant[]>(
        "GET",
        `/api/v1/chats/${pathId(chatId)}/shares`,
      ),
    shareChat: (chatId: string, input: ShareResourceInput) =>
      transport.data<ResourceGrant[]>(
        "POST",
        `/api/v1/chats/${pathId(chatId)}/shares`,
        input,
      ),
    fileShares: (fileId: string) =>
      transport.data<ResourceGrant[]>(
        "GET",
        `/api/v1/files/${pathId(fileId)}/shares`,
      ),
    shareFile: (fileId: string, input: ShareResourceInput) =>
      transport.data<ResourceGrant[]>(
        "POST",
        `/api/v1/files/${pathId(fileId)}/shares`,
        input,
      ),
    agentGallery: (workspaceId?: string) =>
      transport.data<AgentGalleryItem[]>(
        "GET",
        withQuery("/api/v1/agent-gallery", { workspaceId }),
      ),
    favorites: () =>
      transport.data<ResourceFavorite[]>("GET", "/api/v1/favorites"),
    favorite: (input: CreateFavoriteInput) =>
      transport.data<ResourceFavorite>("POST", "/api/v1/favorites", input),
    deleteFavorite: (favoriteId: string) =>
      transport.data<ResourceFavorite>(
        "DELETE",
        `/api/v1/favorites/${pathId(favoriteId)}`,
      ),
    folders: (workspaceId: string) =>
      transport.data<WorkspaceFolder[]>(
        "GET",
        withQuery("/api/v1/folders", { workspaceId }),
      ),
    createFolder: (input: CreateFolderInput) =>
      transport.data<WorkspaceFolder>("POST", "/api/v1/folders", input),
    folder: (folderId: string) =>
      transport.data<WorkspaceFolder>(
        "GET",
        `/api/v1/folders/${pathId(folderId)}`,
      ),
    updateFolder: (folderId: string, input: UpdateFolderInput) =>
      transport.data<WorkspaceFolder>(
        "PATCH",
        `/api/v1/folders/${pathId(folderId)}`,
        input,
      ),
    deleteFolder: (folderId: string) =>
      transport.data<WorkspaceFolder>(
        "DELETE",
        `/api/v1/folders/${pathId(folderId)}`,
      ),
    folderShares: (folderId: string) =>
      transport.data<ResourceGrant[]>(
        "GET",
        `/api/v1/folders/${pathId(folderId)}/shares`,
      ),
    shareFolder: (folderId: string, input: ShareResourceInput) =>
      transport.data<ResourceGrant[]>(
        "POST",
        `/api/v1/folders/${pathId(folderId)}/shares`,
        input,
      ),
    folderItems: (folderId: string) =>
      transport.data<WorkspaceFolderItem[]>(
        "GET",
        `/api/v1/folders/${pathId(folderId)}/items`,
      ),
    addFolderItem: (folderId: string, input: CreateFolderItemInput) =>
      transport.data<WorkspaceFolderItem>(
        "POST",
        `/api/v1/folders/${pathId(folderId)}/items`,
        input,
      ),
    deleteFolderItem: (folderId: string, itemId: string) =>
      transport.data<WorkspaceFolderItem>(
        "DELETE",
        `/api/v1/folders/${pathId(folderId)}/items/${pathId(itemId)}`,
      ),
  };
}
