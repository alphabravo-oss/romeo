import type { Dispatch, SetStateAction } from "react";

import type { BaseModel, Provider } from "../features/types";
import type { FileObject } from "../features/files";

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export interface ChatComposerDialogState {
  fileLibraryOpen: boolean;
  imageDialogOpen: boolean;
  knowledgeLibraryOpen: boolean;
  noteLibraryOpen: boolean;
  promptLibraryOpen: boolean;
  setFileLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setImageDialogOpen: Dispatch<SetStateAction<boolean>>;
  setKnowledgeLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setNoteLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setPromptLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setUrlDialogOpen: Dispatch<SetStateAction<boolean>>;
  urlDialogOpen: boolean;
}

export interface ChatComposerDialogsProps extends ChatComposerDialogState {
  draft: string;
  knowledgeBaseIdsOverride: string[] | undefined;
  models: BaseModel[];
  onAddUrl: (url: string) => void;
  onAttachExistingFile: (file: FileObject) => void;
  onDraftChange: (value: string) => void;
  onGenerateImages: (input: {
    modelId: string;
    prompt: string;
    size: ImageSize;
  }) => void;
  onKnowledgeBaseIdsChange: (knowledgeBaseIds: string[] | undefined) => void;
  providers: Provider[];
  selectedModelId: string | undefined;
  workspaceId: string | undefined;
}
