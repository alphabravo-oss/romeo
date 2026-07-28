import {
  filesCancelResumableUploadSession,
  filesCancelUploadSession,
  filesCompleteResumableUploadSession,
  filesCompleteUploadSession,
  filesCreate,
  filesCreateResumableUploadSession,
  filesCreateUploadSession,
  filesDelete,
  filesRetryExtraction,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  FileObject,
  FileResumableUploadSession,
  FileUploadSession,
} from "./types";

export async function createFile(
  input: Parameters<typeof filesCreate>[0]["body"],
): Promise<FileObject> {
  configureBrowserApiClients();
  const response = await filesCreate({ body: input, throwOnError: true });
  return response.data.data;
}

export async function createChatFile(input: {
  workspaceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
}): Promise<FileObject> {
  return createFile({ ...input, purpose: "chat_attachment" });
}

export async function createFileUploadSession(
  input: Parameters<typeof filesCreateUploadSession>[0]["body"],
): Promise<FileUploadSession> {
  configureBrowserApiClients();
  const response = await filesCreateUploadSession({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createResumableUploadSession(
  input: Parameters<typeof filesCreateResumableUploadSession>[0]["body"],
): Promise<FileResumableUploadSession> {
  configureBrowserApiClients();
  const response = await filesCreateResumableUploadSession({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function completeFileUploadSession(
  fileId: string,
): Promise<FileObject> {
  configureBrowserApiClients();
  const response = await filesCompleteUploadSession({
    path: { fileId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function completeResumableUploadSession(
  fileId: string,
): Promise<FileObject> {
  configureBrowserApiClients();
  const response = await filesCompleteResumableUploadSession({
    path: { fileId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function cancelFileUploadSession(
  fileId: string,
): Promise<FileObject> {
  configureBrowserApiClients();
  const response = await filesCancelUploadSession({
    path: { fileId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function cancelResumableUploadSession(
  fileId: string,
): Promise<FileObject> {
  configureBrowserApiClients();
  const response = await filesCancelResumableUploadSession({
    path: { fileId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteFile(fileId: string): Promise<FileObject> {
  configureBrowserApiClients();
  const response = await filesDelete({
    path: { fileId },
    throwOnError: true,
  });
  return response.data.data;
}

export const deleteChatFile = deleteFile;

export async function retryFileExtraction(fileId: string): Promise<FileObject> {
  configureBrowserApiClients();
  const response = await filesRetryExtraction({
    path: { fileId },
    throwOnError: true,
  });
  return response.data.data;
}
