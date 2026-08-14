import { describe, expect, it, vi } from "vitest";

import { generateOpenAiCompatibleImages } from "./index";

describe("OpenAI-compatible image adapter", () => {
  it("uses the OpenAI SDK and returns provider-neutral image data", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          created: 1,
          data: [
            {
              b64_json: "aW1hZ2U=",
              revised_prompt: "A governed abstract workspace",
            },
          ],
        }),
    );

    await expect(
      generateOpenAiCompatibleImages({
        apiKey: "sk_image",
        count: 1,
        fetchImpl,
        model: "gpt-image-1",
        prompt: "Abstract workspace",
        provider: { baseUrl: "https://images.example.com/v1/" },
        size: "1024x1024",
      }),
    ).resolves.toEqual([
      {
        b64Json: "aW1hZ2U=",
        revisedPrompt: "A governed abstract workspace",
      },
    ]);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://images.example.com/v1/images/generations",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer sk_image",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-image-1",
      prompt: "Abstract workspace",
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    });
  });

  it("normalizes SDK HTTP failures without exposing response bodies", async () => {
    const secret = "SENTINEL_IMAGE_PROVIDER_SECRET";
    const pending = generateOpenAiCompatibleImages({
      count: 1,
      fetchImpl: async () =>
        Response.json({ error: { message: secret } }, { status: 429 }),
      model: "gpt-image-1",
      prompt: "Abstract workspace",
      provider: { baseUrl: "https://images.example.com/v1" },
      size: "1024x1024",
    });

    const caught = await pending.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(caught).toMatchObject({
      category: "rate_limit",
      errorCode: "provider_rate_limited",
      operation: "imageGeneration",
      status: 429,
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
  });
});
