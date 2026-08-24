export function createRetryableImport<T>(
  importer: () => Promise<T>,
): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= importer().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
