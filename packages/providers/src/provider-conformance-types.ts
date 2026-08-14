import type {
  BaseModel,
  ProviderDialect,
  ProviderInstance,
  ProviderKind,
  ProviderTokenUsage,
} from "./types";

export const PROVIDER_ADAPTER_CONFORMANCE_CASE_NAMES = [
  "golden_stream",
  "tool_calls",
  "malformed_chunks",
  "usage_parsing",
  "cancellation",
  "retry_error_normalization",
  "privacy_sentinels",
  "hidden_reasoning_privacy",
  "network_failures",
] as const;

export type ProviderAdapterConformanceCaseName =
  (typeof PROVIDER_ADAPTER_CONFORMANCE_CASE_NAMES)[number];

export interface ProviderAdapterConformanceFixture {
  readonly dialect: Readonly<ProviderDialect>;
  readonly goldenStream: {
    readonly createResponse: () => Response;
    readonly text: readonly string[];
    readonly usage: Readonly<ProviderTokenUsage>;
  };
  readonly kind: ProviderKind;
  readonly malformedStream: { readonly createResponse: () => Response };
  readonly model: Readonly<BaseModel>;
  readonly provider: Readonly<ProviderInstance>;
  readonly rawReasoningStream: { readonly createResponse: () => Response };
  readonly toolCallStream: {
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly argumentKeys: readonly string[];
    readonly createResponse: () => Response;
    readonly name: string;
  };
  readonly usageEvents: readonly unknown[];
  readonly usage: Readonly<ProviderTokenUsage>;
}

export interface ProviderAdapterConformanceCase {
  readonly kind: ProviderKind;
  readonly name: ProviderAdapterConformanceCaseName;
  run(): Promise<void>;
}
