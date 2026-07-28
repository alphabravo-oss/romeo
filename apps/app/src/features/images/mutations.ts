import { imagesGenerate } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { GeneratedImageArtifact } from "./types";

export async function generateImages(
  input: Parameters<typeof imagesGenerate>[0]["body"],
): Promise<GeneratedImageArtifact[]> {
  configureBrowserApiClients();
  const response = await imagesGenerate({ body: input, throwOnError: true });
  return response.data.data;
}
