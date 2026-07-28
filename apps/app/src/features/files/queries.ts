import {
  client,
  filesGet,
  filesGetResumableUploadSession,
  filesGetUploadSession,
  filesList,
  filesReadContent,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  FileObject,
  FilePage,
  FileResumableUploadSession,
  FileUploadSession,
} from "./types";

export async function listFiles(workspaceId: string): Promise<FileObject[]> {
  configureBrowserApiClients();
  const response = await filesList({
    query: { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listFilesPage(
  workspaceId: string,
  options: { limit?: number; offset?: number; query?: string } = {},
): Promise<FilePage> {
  configureBrowserApiClients();
  const response = await filesList({
    query: {
      workspaceId,
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
      ...(options.query?.trim() ? { q: options.query.trim() } : {}),
    },
    throwOnError: true,
  });
  const meta = response.data.meta;
  if (meta === undefined) {
    throw new Error(
      "The paginated file response did not include page metadata.",
    );
  }
  return { items: response.data.data, ...meta };
}

export async function getFile(fileId: string): Promise<FileObject> {
  configureBrowserApiClients();
  const response = await filesGet({ path: { fileId }, throwOnError: true });
  return response.data.data;
}

export function fileContentUrl(fileId: string): string {
  configureBrowserApiClients();
  return client.buildUrl({
    url: "/files/{fileId}/content",
    path: { fileId },
  });
}

export async function readFileContent(fileId: string): Promise<Blob> {
  configureBrowserApiClients();
  const response = await filesReadContent({
    path: { fileId },
    throwOnError: true,
  });
  return response.data;
}

export async function getFileUploadSession(
  fileId: string,
): Promise<FileUploadSession> {
  configureBrowserApiClients();
  const response = await filesGetUploadSession({
    path: { fileId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getResumableUploadSession(
  fileId: string,
): Promise<FileResumableUploadSession> {
  configureBrowserApiClients();
  const response = await filesGetResumableUploadSession({
    path: { fileId },
    throwOnError: true,
  });
  return response.data.data;
}
