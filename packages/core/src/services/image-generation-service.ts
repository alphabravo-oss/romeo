import { assertScope, canAccessOrg, type AuthSubject } from "@romeo/auth";
import { getImageGenerationAdapter } from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { writeAuditLog } from "./audit-log";
import { CapabilityService } from "./capability-resolver";
import { consumeQuotas } from "./consume-quota";
import { enforceContentPolicyText } from "./content-policy-service";
import type { FileObjectResponse, FileService } from "./file-service";
import type { QuotaCoordinator } from "./quota-coordination";
import { recordUsage } from "./record-usage";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { providerApiError } from "./provider-api-error";
import type { SecretResolver } from "./secret-resolver";
import type { WebhookEmitter } from "./webhook-service";

export interface GeneratedImageArtifact {
  id: string;
  file: FileObjectResponse;
  revisedPrompt?: string;
}

export class ImageGenerationService {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly files: FileService,
    private readonly options: {
      capabilities?: CapabilityService;
      fetchImpl?: typeof fetch;
      quotaCoordinator?: QuotaCoordinator;
      secretResolver?: SecretResolver;
      webhooks?: WebhookEmitter;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(
    subject: AuthSubject,
    input: {
      workspaceId: string;
      modelId: string;
      prompt: string;
      count: number;
      size: "1024x1024" | "1024x1536" | "1536x1024";
    },
    command: { providerIdempotencyKey?: string } = {},
  ): Promise<GeneratedImageArtifact[]> {
    assertScope(subject, "runs:create");
    assertScope(subject, "models:read");
    const authorization = await (
      this.options.capabilities ?? new CapabilityService(this.repository)
    ).authorizeImageGeneration({
      subject,
      workspaceId: input.workspaceId,
      modelId: input.modelId,
      count: input.count,
      size: input.size,
    });
    const count = authorization.count;
    const prompt = (
      await enforceContentPolicyText(this.repository, subject, input.prompt)
    ).content;
    const model = await this.repository.getModel(input.modelId);
    if (model === undefined) throw notFound("Model");
    const provider = await this.repository.getProvider(model.providerId);
    if (provider === undefined || !canAccessOrg(subject, provider.orgId))
      throw notFound("Model");
    if (!provider.enabled || !model.enabled || model.available === false)
      throw new ApiError(
        "image_model_disabled",
        "The selected image model is disabled.",
        409,
      );
    if (!model.capabilities.imageGeneration) {
      throw new ApiError(
        "image_model_unsupported",
        "The selected model is not configured for image generation. Enable that capability in the model catalog or select an image model.",
        409,
      );
    }
    let imageAdapter: ReturnType<typeof getImageGenerationAdapter>;
    try {
      imageAdapter = getImageGenerationAdapter(provider.type);
    } catch {
      throw new ApiError(
        "image_provider_unsupported",
        "The selected provider dialect does not support image generation.",
        409,
      );
    }
    const credential = await this.resolveCredential(provider.credentialRef);
    const unitPriceUsd = model.pricing?.imageGenerationUsd?.[input.size];
    const estimatedCostUsd =
      unitPriceUsd === undefined ? undefined : unitPriceUsd * count;
    const estimatedCostMicroUsd =
      estimatedCostUsd === undefined
        ? undefined
        : Math.ceil(estimatedCostUsd * 1_000_000);
    if (
      unitPriceUsd === undefined &&
      (await hasApplicableImageCostQuota(
        this.repository,
        subject,
        input.workspaceId,
        provider.id,
      ))
    ) {
      throw new ApiError(
        "image_pricing_required",
        "Image pricing must be configured before a cost quota can be enforced.",
        409,
      );
    }
    await this.repository.transaction((repository) =>
      consumeQuotas(
        repository,
        subject,
        [
          {
            metric: "image.generated",
            providerId: provider.id,
            workspaceId: input.workspaceId,
            quantity: count,
          },
          ...(estimatedCostMicroUsd === undefined
            ? []
            : [
                {
                  metric: "image.cost.micro_usd",
                  providerId: provider.id,
                  workspaceId: input.workspaceId,
                  quantity: estimatedCostMicroUsd,
                },
              ]),
        ],
        {
          quotaCoordinator: this.options.quotaCoordinator,
          webhooks: this.options.webhooks,
        },
      ),
    );
    let data;
    try {
      data = await imageAdapter.generate({
        provider,
        ...(credential === undefined ? {} : { apiKey: credential }),
        fetchImpl: this.fetchImpl,
        model: model.name,
        prompt,
        count,
        size: input.size,
        ...(command.providerIdempotencyKey === undefined
          ? {}
          : { idempotencyKey: command.providerIdempotencyKey }),
      });
    } catch (caught) {
      throw providerApiError(caught, {
        kind: provider.type,
        operation: "imageGeneration",
      });
    }
    if (!Array.isArray(data) || data.length < count) {
      throw new ApiError(
        "image_provider_invalid_response",
        "Image provider did not return image data.",
        502,
      );
    }
    const artifacts: GeneratedImageArtifact[] = [];
    try {
      for (const [index, raw] of data.slice(0, count).entries()) {
        const dataBase64 =
          typeof raw.b64Json === "string" ? raw.b64Json : undefined;
        if (dataBase64 === undefined || dataBase64.length > 14_000_000) {
          throw new ApiError(
            "image_provider_invalid_response",
            "Image provider returned an unsupported image payload.",
            502,
          );
        }
        const bytes = Buffer.from(dataBase64, "base64");
        if (bytes.byteLength === 0 || bytes.byteLength > 10_000_000) {
          throw new ApiError(
            "image_provider_payload_too_large",
            "Generated image exceeds the 10 MB artifact limit.",
            413,
          );
        }
        const file = await this.files.create(subject, {
          workspaceId: input.workspaceId,
          fileName: `generated-${Date.now()}-${index + 1}.png`,
          mimeType: "image/png",
          sizeBytes: bytes.byteLength,
          dataBase64,
          purpose: "generated_image",
          metadata: {
            providerId: provider.id,
            modelId: model.id,
            size: input.size,
            promptHashOnly: true,
            ...(unitPriceUsd === undefined ? {} : { unitPriceUsd }),
            ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
          },
        });
        const revisedPrompt =
          typeof raw.revisedPrompt === "string" ? raw.revisedPrompt : undefined;
        artifacts.push({
          id: file.id,
          file,
          ...(revisedPrompt === undefined ? {} : { revisedPrompt }),
        });
      }
    } catch (error) {
      await Promise.all(
        artifacts.map((artifact) =>
          this.files.delete(subject, artifact.file.id).catch(() => undefined),
        ),
      );
      throw error;
    }
    await writeAuditLog(this.repository, {
      subject,
      action: "image.generate",
      resourceType: "model",
      resourceId: model.id,
      metadata: {
        workspaceId: input.workspaceId,
        providerId: provider.id,
        artifactCount: artifacts.length,
        size: input.size,
        promptLength: prompt.length,
        ...(unitPriceUsd === undefined ? {} : { unitPriceUsd }),
        ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
      },
    });
    const actorId = await persistedSubjectActorId(this.repository, subject, {
      kind: "image_generation_usage",
      name: "Image generation usage actor",
    });
    await recordUsage(this.repository, {
      orgId: subject.orgId,
      workspaceId: input.workspaceId,
      actorId,
      sourceType: "run",
      sourceId: artifacts[0]!.id,
      metric: "image.generated",
      quantity: artifacts.length,
      unit: "image",
      metadata: {
        providerId: provider.id,
        modelId: model.id,
        size: input.size,
        pricingConfigured: unitPriceUsd !== undefined,
        ...(unitPriceUsd === undefined ? {} : { unitPriceUsd }),
        ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
        ...(estimatedCostMicroUsd === undefined
          ? {}
          : { estimatedCostMicroUsd }),
      },
    });
    if (estimatedCostMicroUsd !== undefined) {
      await recordUsage(this.repository, {
        orgId: subject.orgId,
        workspaceId: input.workspaceId,
        actorId,
        sourceType: "run",
        sourceId: artifacts[0]!.id,
        metric: "image.cost.micro_usd",
        quantity: estimatedCostMicroUsd,
        unit: "micro_usd",
        metadata: {
          providerId: provider.id,
          modelId: model.id,
          size: input.size,
          unitPriceUsd,
        },
      });
    }
    return artifacts;
  }

  private async resolveCredential(
    secretRef: string | undefined,
  ): Promise<string | undefined> {
    if (secretRef === undefined) return undefined;
    const resolution =
      await this.options.secretResolver?.resolveValue?.(secretRef);
    if (resolution?.value === undefined)
      throw new ApiError(
        "image_provider_credential_unavailable",
        "The image provider credential could not be resolved.",
        409,
      );
    return resolution.value;
  }
}

async function hasApplicableImageCostQuota(
  repository: RomeoRepository,
  subject: AuthSubject,
  workspaceId: string,
  providerId: string,
): Promise<boolean> {
  return (await repository.listQuotaBuckets(subject.orgId)).some((bucket) => {
    if (bucket.metric !== "image.cost.micro_usd") return false;
    if (bucket.scopeType === "org") return bucket.scopeId === subject.orgId;
    if (bucket.scopeType === "user") return bucket.scopeId === subject.id;
    if (bucket.scopeType === "workspace") return bucket.scopeId === workspaceId;
    if (bucket.scopeType === "provider") return bucket.scopeId === providerId;
    if (bucket.scopeType === "api_key")
      return bucket.scopeId === subject.apiKeyId;
    return false;
  });
}
