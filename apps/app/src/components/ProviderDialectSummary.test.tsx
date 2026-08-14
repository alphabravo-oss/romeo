import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { MessageKey } from "../lib/i18n";
import { ProviderDialectSummaryView } from "./ProviderDialectSummary";

const copy: Partial<Record<MessageKey, string>> = {
  providerDialect: "Provider dialect",
  providerDialectAudio: "Audio",
  providerDialectBatches: "Batches",
  providerDialectCapabilityProbing: "Capability probing",
  providerDialectChat: "Chat",
  providerDialectContractVersion: "Contract version",
  providerDialectDescription:
    "Protocol implementation and operations available through Romeo.",
  providerDialectDiscovery: "Discovery",
  providerDialectEmbeddings: "Embeddings",
  providerDialectErrorNormalization: "Error normalization",
  providerDialectFiles: "Files",
  providerDialectImageGeneration: "Image generation",
  providerDialectImplementationVersion: "Implementation version",
  providerDialectOperations: "Implemented operations",
  providerDialectSupported: "Supported",
  providerDialectTokenCounting: "Token counting",
  providerDialectUnsupported: "Unsupported",
  providerDialectUsageParsing: "Usage parsing",
};

const t = (key: MessageKey) => copy[key] ?? key;

describe("ProviderDialectSummary", () => {
  it("shows versioned, truthful operation support with explicit labels", () => {
    const markup = renderToStaticMarkup(
      <ProviderDialectSummaryView
        dialect={{
          contractVersion: "1",
          operations: {
            audio: false,
            batches: false,
            capabilityProbing: false,
            chat: true,
            discovery: true,
            embeddings: false,
            errorNormalization: false,
            files: false,
            imageGeneration: false,
            tokenCounting: false,
            usageParsing: true,
          },
          version: "anthropic-messages.v1",
        }}
        headingId="dialect-heading"
        t={t}
      />,
    );

    expect(markup).toContain('aria-labelledby="dialect-heading"');
    expect(markup).toContain('translate="no">anthropic-messages.v1');
    expect(markup).toContain("Chat");
    expect(markup).toContain("Usage parsing");
    expect(markup.match(/Supported/g)).toHaveLength(3);
    expect(markup.match(/Unsupported/g)).toHaveLength(8);
    expect(markup).not.toContain("credential");
    expect(markup).not.toContain("baseUrl");
  });
});
