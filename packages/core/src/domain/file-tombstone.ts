const emptyContentSha256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * Content-free fields retained for a soft-deleted file row. Keeping the row
 * preserves referential/audit continuity without retaining names, extracted
 * text, source URLs, object keys, hashes of user content, or preview metadata.
 */
export function fileTombstoneFields(fileId: string, deletedAt: string) {
  return {
    fileName: "deleted",
    mimeType: "application/octet-stream",
    sizeBytes: 0,
    sha256: emptyContentSha256,
    objectKey: `deleted/${fileId}`,
    status: "deleted" as const,
    metadata: { contentPurged: true },
    deletedAt,
    updatedAt: deletedAt,
  };
}
