import { errorResponse, jsonContent, success } from "./helpers";

const fileIdParameter = {
  name: "fileId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

export const filePaths = {
  "/files": {
    get: {
      summary: "List authorized files",
      parameters: [
        {
          name: "workspaceId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Authorized file metadata", {
          type: "array",
          items: { $ref: "#/components/schemas/FileObject" },
        }),
        401: errorResponse,
        403: errorResponse,
      },
    },
    post: {
      summary: "Upload a bounded file",
      description:
        "Stores bytes through the configured object-store abstraction and persists sanitized metadata in object_records. Raw object keys are not returned.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateFileRequest",
        }),
      },
      responses: {
        201: success("Created file metadata", {
          $ref: "#/components/schemas/FileObject",
        }),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        415: errorResponse,
      },
    },
  },
  "/files/uploads": {
    post: {
      summary: "Create a direct file upload session",
      description:
        "Creates uploading metadata and returns a short-lived object-store PUT URL. Completion verifies declared size and SHA-256 before the file becomes readable.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateFileUploadSessionRequest",
        }),
      },
      responses: {
        201: success("Created file upload session", {
          $ref: "#/components/schemas/FileUploadSession",
        }),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        415: errorResponse,
      },
    },
  },
  "/files/uploads/resumable": {
    post: {
      summary: "Create a resumable file upload session",
      description:
        "Creates uploading metadata and returns short-lived object-store PUT URLs for bounded parts. Completion composes parts server-side, verifies declared size and SHA-256, verifies MIME signature, and then marks the file readable.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateFileResumableUploadSessionRequest",
        }),
      },
      responses: {
        201: success("Created resumable file upload session", {
          $ref: "#/components/schemas/FileResumableUploadSession",
        }),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        415: errorResponse,
      },
    },
  },
  "/files/uploads/resumable/{fileId}": {
    get: {
      summary: "Refresh a resumable file upload session",
      description:
        "Returns fresh short-lived PUT URLs for all parts in an active resumable upload without exposing object-store keys as metadata.",
      parameters: [fileIdParameter],
      responses: {
        200: success("Refreshed resumable file upload session", {
          $ref: "#/components/schemas/FileResumableUploadSession",
        }),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
    delete: {
      summary: "Cancel a resumable file upload session",
      description:
        "Deletes staged part objects, deletes any final object if present, and marks the uploading file metadata deleted.",
      parameters: [fileIdParameter],
      responses: {
        200: success("Cancelled resumable file upload metadata", {
          $ref: "#/components/schemas/FileObject",
        }),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/files/uploads/resumable/{fileId}/complete": {
    post: {
      summary: "Complete a resumable file upload session",
      description:
        "Reads uploaded part objects through the storage adapter, verifies part sizes, composes the final object, verifies declared size, SHA-256, and MIME signature, deletes staged parts, and marks metadata available.",
      parameters: [fileIdParameter],
      responses: {
        200: success("Completed resumable file metadata", {
          $ref: "#/components/schemas/FileObject",
        }),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/files/uploads/{fileId}": {
    get: {
      summary: "Refresh a direct file upload session",
      description:
        "Returns a fresh short-lived PUT URL for an active uploading file without exposing object-store keys.",
      parameters: [fileIdParameter],
      responses: {
        200: success("Refreshed file upload session", {
          $ref: "#/components/schemas/FileUploadSession",
        }),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
    delete: {
      summary: "Cancel a direct file upload session",
      description:
        "Deletes any staged object bytes and marks the uploading file metadata deleted.",
      parameters: [fileIdParameter],
      responses: {
        200: success("Cancelled file upload metadata", {
          $ref: "#/components/schemas/FileObject",
        }),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/files/uploads/{fileId}/complete": {
    post: {
      summary: "Complete a direct file upload session",
      description:
        "Reads the uploaded object through the storage adapter, verifies declared size and SHA-256, then marks metadata available.",
      parameters: [fileIdParameter],
      responses: {
        200: success("Completed file metadata", {
          $ref: "#/components/schemas/FileObject",
        }),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/files/{fileId}": {
    get: {
      summary: "Get authorized file metadata",
      parameters: [fileIdParameter],
      responses: {
        200: success("File metadata", {
          $ref: "#/components/schemas/FileObject",
        }),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    delete: {
      summary: "Delete an authorized file",
      description:
        "Deletes the backing object through the configured object store and marks metadata deleted without returning object-store keys.",
      parameters: [fileIdParameter],
      responses: {
        200: success("Deleted file metadata", {
          $ref: "#/components/schemas/FileObject",
        }),
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/files/{fileId}/content": {
    get: {
      summary: "Read authorized file bytes",
      parameters: [fileIdParameter],
      responses: {
        200: {
          description: "File bytes",
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
};
