import type {
  GenerateProviderImagesInput,
  GeneratedProviderImage,
  ProviderImageAdapter,
} from "../types";
import { createOpenAiClient, normalizeProviderSdkError } from "./provider-sdk";

export type GenerateOpenAiCompatibleImagesInput = GenerateProviderImagesInput;
export type { GeneratedProviderImage } from "../types";

export async function generateOpenAiCompatibleImages(
  input: GenerateOpenAiCompatibleImagesInput,
): Promise<GeneratedProviderImage[]> {
  try {
    const response = await createOpenAiClient(
      input.provider,
      input.apiKey,
      input.fetchImpl,
    ).images.generate(
      {
        model: input.model,
        prompt: input.prompt,
        n: input.count,
        size: input.size,
        response_format: "b64_json",
      },
      input.signal === undefined && input.idempotencyKey === undefined
        ? undefined
        : {
            ...(input.signal === undefined ? {} : { signal: input.signal }),
            ...(input.idempotencyKey === undefined
              ? {}
              : { headers: { "Idempotency-Key": input.idempotencyKey } }),
          },
    );
    return (response.data ?? []).map((image) => ({
      ...(image.b64_json === undefined ? {} : { b64Json: image.b64_json }),
      ...(image.revised_prompt === undefined
        ? {}
        : { revisedPrompt: image.revised_prompt }),
    }));
  } catch (caught) {
    throw normalizeProviderSdkError(
      caught,
      "openai-compatible",
      "imageGeneration",
    );
  }
}

export const openAiCompatibleImageAdapter: ProviderImageAdapter = {
  kind: "openai-compatible",
  generate: generateOpenAiCompatibleImages,
};
