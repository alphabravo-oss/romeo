import { pathId, withQuery } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  CreateFileInput,
  CreateFileResumableUploadSessionInput,
  CreateFileUploadSessionInput,
  FileObject,
  FileResumableUploadSession,
  FileUploadSession,
} from "../types";

export function createFileResource(transport: RomeoTransport) {
  return {
    list: (workspaceId?: string) =>
      transport.data<FileObject[]>(
        "GET",
        withQuery("/api/v1/files", { workspaceId }),
      ),
    create: (input: CreateFileInput) =>
      transport.data<FileObject>("POST", "/api/v1/files", input),
    createUploadSession: (input: CreateFileUploadSessionInput) =>
      transport.data<FileUploadSession>("POST", "/api/v1/files/uploads", input),
    createResumableUploadSession: (
      input: CreateFileResumableUploadSessionInput,
    ) =>
      transport.data<FileResumableUploadSession>(
        "POST",
        "/api/v1/files/uploads/resumable",
        input,
      ),
    resumableUploadSession: (fileId: string) =>
      transport.data<FileResumableUploadSession>(
        "GET",
        `/api/v1/files/uploads/resumable/${pathId(fileId)}`,
      ),
    completeResumableUploadSession: (fileId: string) =>
      transport.data<FileObject>(
        "POST",
        `/api/v1/files/uploads/resumable/${pathId(fileId)}/complete`,
      ),
    cancelResumableUploadSession: (fileId: string) =>
      transport.data<FileObject>(
        "DELETE",
        `/api/v1/files/uploads/resumable/${pathId(fileId)}`,
      ),
    uploadSession: (fileId: string) =>
      transport.data<FileUploadSession>(
        "GET",
        `/api/v1/files/uploads/${pathId(fileId)}`,
      ),
    completeUploadSession: (fileId: string) =>
      transport.data<FileObject>(
        "POST",
        `/api/v1/files/uploads/${pathId(fileId)}/complete`,
      ),
    cancelUploadSession: (fileId: string) =>
      transport.data<FileObject>(
        "DELETE",
        `/api/v1/files/uploads/${pathId(fileId)}`,
      ),
    get: (fileId: string) =>
      transport.data<FileObject>("GET", `/api/v1/files/${pathId(fileId)}`),
    content: (fileId: string) =>
      transport.bytes("GET", `/api/v1/files/${pathId(fileId)}/content`),
    delete: (fileId: string) =>
      transport.data<FileObject>("DELETE", `/api/v1/files/${pathId(fileId)}`),
  };
}
