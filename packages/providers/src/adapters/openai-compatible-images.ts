import type { ProviderInstance } from "../types";
import { createOpenAiClient, ProviderSdkRequestError } from "./provider-sdk";

export interface GenerateOpenAiCompatibleImagesInput {
  apiKey?: string;
  count: number;
  fetchImpl?: typeof fetch;
  model: string;
  prompt: string;
  provider: Pick<ProviderInstance, "baseUrl">;
  signal?: AbortSignal;
  size: "1024x1024" | "1024x1536" | "1536x1024";
}

export interface GeneratedProviderImage {
  b64Json?: string;
  revisedPrompt?: string;
}

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
      input.signal === undefined ? undefined : { signal: input.signal },
    );
    return (response.data ?? []).map((image) => ({
      ...(image.b64_json === undefined ? {} : { b64Json: image.b64_json }),
      ...(image.revised_prompt === undefined
        ? {}
        : { revisedPrompt: image.revised_prompt }),
    }));
  } catch (caught) {
    throw new ProviderSdkRequestError("openai-compatible", caught);
  }
}
