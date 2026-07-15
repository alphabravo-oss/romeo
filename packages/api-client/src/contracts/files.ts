export type FileObjectPurpose =
  | "browser_artifact"
  | "chat_attachment"
  | "connector_import"
  | "export_bundle"
  | "general"
  | "generated_image"
  | "knowledge_source"
  | "voice_artifact";

export interface FileObject {
  id: string;
  workspaceId: string;
  ownerType: "service_account" | "user";
  ownerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  purpose: FileObjectPurpose;
  status: "available" | "deleted" | "uploading";
  metadata: Record<string, unknown>;
  contentUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CreateFileInput {
  workspaceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  purpose?: FileObjectPurpose;
  metadata?: Record<string, unknown>;
}

export interface CreateFileUploadSessionInput {
  workspaceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  purpose?: FileObjectPurpose;
  metadata?: Record<string, unknown>;
}

export interface CreateFileResumableUploadSessionInput extends CreateFileUploadSessionInput {
  partSizeBytes?: number;
}

export interface FileUploadSession {
  file: FileObject;
  upload: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresAt: string;
    maxBytes: number;
  };
}

export interface FileResumableUploadSession {
  file: FileObject;
  upload: {
    mode: "resumable_backend_composed";
    partCount: number;
    partSizeBytes: number;
    maxBytes: number;
    parts: Array<{
      partNumber: number;
      sizeBytes: number;
      upload: {
        url: string;
        method: "PUT";
        headers: Record<string, string>;
        expiresAt: string;
      };
    }>;
  };
}
