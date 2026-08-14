import { ObjectSizeLimitError, type ObjectStore } from "@romeo/storage";

import { ApiError } from "../errors";

/** Reads a registered knowledge object without ever buffering past its quota. */
export async function readKnowledgeObject(
  objectStore: ObjectStore,
  input: { key: string; sizeBytes: number },
): Promise<Uint8Array> {
  const metadata = await objectStore.headObject?.(input.key);
  if (objectStore.headObject !== undefined && metadata === undefined)
    throw missingObject();
  if (metadata !== undefined && metadata.sizeBytes !== input.sizeBytes) {
    await objectStore.deleteObject(input.key);
    throw sizeMismatch();
  }
  try {
    const bytes = await objectStore.getObject(input.key, {
      maxBytes: input.sizeBytes,
    });
    if (bytes === undefined) throw missingObject();
    if (bytes.byteLength !== input.sizeBytes) {
      await objectStore.deleteObject(input.key);
      throw sizeMismatch();
    }
    return bytes;
  } catch (error) {
    if (!(error instanceof ObjectSizeLimitError)) throw error;
    await objectStore.deleteObject(input.key);
    throw sizeMismatch();
  }
}

function missingObject(): ApiError {
  return new ApiError(
    "upload_object_missing",
    "Uploaded object was not found in object storage.",
    409,
  );
}

function sizeMismatch(): ApiError {
  return new ApiError(
    "upload_size_mismatch",
    "Uploaded object byte count does not match the declared size.",
    400,
  );
}
