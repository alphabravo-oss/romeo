import { assertScope, canAccessOrg, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { writeAuditLog } from "./audit-log";
import {
  evaluateProviderProbe,
  mergeProviderCapabilityRecords,
  type ProviderCapabilityRecord,
} from "./provider-capability-merge";
import { previewModelCompatibility } from "./provider-adapter-contracts";
import { authorizeCompareLegs } from "./compare-leg-authorization";

export const MODEL_PROBE_FEATURES = [
  "streaming",
  "tools",
  "json",
  "vision",
  "audio",
  "reasoning",
] as const;
export type ModelProbeFeature = (typeof MODEL_PROBE_FEATURES)[number];

const OVERRIDE_SCHEMA = "romeo.model-capability-override.v1";
const PROBE_SCHEMA = "romeo.model-capability-probe.v1";

export class ModelCapabilityProbeService {
  constructor(private readonly repository: RomeoRepository) {}

  authorizeCompareLegs(subject: AuthSubject, modelIds: string[]) {
    return authorizeCompareLegs({
      repository: this.repository,
      subject,
      modelIds,
    });
  }

  async probe(input: {
    subject: AuthSubject;
    modelId: string;
    features: ModelProbeFeature[];
  }) {
    const { model, provider } = await this.load(input.subject, input.modelId);
    const advertised = advertisedFeatures(model.capabilities);
    const results = input.features.map((feature) => {
      const probe = evaluateProviderProbe({
        advertised: advertised.has(feature),
        probed: advertised.has(feature),
      });
      return {
        feature,
        advertised: advertised.has(feature),
        probed: advertised.has(feature),
        outcome: probe.outcome,
        ...(probe.outcome === "mismatch" ? { code: probe.code } : {}),
      };
    });
    const probedAt = new Date().toISOString();
    await this.repository.upsertSystemSetting({
      key: probeKey(input.subject.orgId, model.id),
      updatedAt: probedAt,
      value: {
        modelId: model.id,
        orgId: input.subject.orgId,
        probedAt,
        schema: PROBE_SCHEMA,
      },
    });
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "model.capability.probe",
      resourceType: "model",
      resourceId: model.id,
      metadata: { featureCount: input.features.length, providerId: provider.id },
    });
    return {
      modelId: model.id,
      probedAt,
      results,
    };
  }

  async override(input: {
    subject: AuthSubject;
    modelId: string;
    tools?: boolean;
    reasoning?: boolean;
    vision?: boolean;
    imageOutput?: boolean;
    reason: string;
    expiresAt?: string;
  }) {
    assertScope(input.subject, "providers:write");
    const { model } = await this.load(input.subject, input.modelId);
    const now = new Date().toISOString();
    const record: ProviderCapabilityRecord = {
      value: {
        ...(input.tools === undefined ? {} : { tools: input.tools }),
        ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
        ...(input.vision === undefined ? {} : { vision: input.vision }),
        ...(input.imageOutput === undefined
          ? {}
          : { imageOutput: input.imageOutput }),
        reason: input.reason,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      },
      source: "override",
      updatedAt: now,
      sourceVersion: "1",
    };
    const current = await this.readOverride(input.subject.orgId, model.id);
    const merged = mergeProviderCapabilityRecords({
      ...(current === undefined ? {} : { current }),
      incoming: record,
    });
    await this.repository.upsertSystemSetting({
      key: overrideKey(input.subject.orgId, model.id),
      value: { schema: OVERRIDE_SCHEMA, orgId: input.subject.orgId, record: merged },
      updatedAt: now,
    });
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "model.capability.override",
      resourceType: "model",
      resourceId: model.id,
      metadata: { source: merged.source },
    });
    return { modelId: model.id, source: merged.source, updatedAt: now };
  }

  async preview(input: {
    subject: AuthSubject;
    modelId: string;
    required: {
      attachments: boolean;
      tools: boolean;
      reasoning: boolean;
      imageOutput: boolean;
      localOnly: boolean;
    };
  }) {
    const { model, provider } = await this.load(input.subject, input.modelId);
    return {
      modelId: model.id,
      ...previewModelCompatibility({
        required: input.required,
        model: {
          tools: model.capabilities.toolCalling,
          reasoning: model.capabilities.reasoning === true,
          imageOutput: model.capabilities.imageGeneration === true,
          localRuntime: provider.type === "ollama",
          regionAllowed: true,
          entitled: model.enabled && model.available !== false,
        },
      }),
    };
  }

  private async load(subject: AuthSubject, modelId: string) {
    assertScope(subject, "models:read");
    const model = await this.repository.getModel(modelId);
    if (model === undefined) throw notFound("Model");
    const provider = await this.repository.getProvider(model.providerId);
    if (provider === undefined || !canAccessOrg(subject, provider.orgId))
      throw notFound("Model");
    return { model, provider };
  }

  private async readOverride(
    orgId: string,
    modelId: string,
  ): Promise<ProviderCapabilityRecord | undefined> {
    const value = (await this.repository.getSystemSetting(overrideKey(orgId, modelId)))
      ?.value;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const candidate = value as Record<string, unknown>;
    if (candidate.schema !== OVERRIDE_SCHEMA) return undefined;
    return candidate.record as ProviderCapabilityRecord;
  }
}

function advertisedFeatures(capabilities: {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  audioInput: boolean;
  structuredJson: boolean;
  reasoning: boolean;
}): Set<ModelProbeFeature> {
  const features = new Set<ModelProbeFeature>();
  if (capabilities.streaming) features.add("streaming");
  if (capabilities.toolCalling) features.add("tools");
  if (capabilities.structuredJson) features.add("json");
  if (capabilities.vision) features.add("vision");
  if (capabilities.audioInput) features.add("audio");
  if (capabilities.reasoning) features.add("reasoning");
  return features;
}

function overrideKey(orgId: string, modelId: string): string {
  return `model.capability.override.v1:${orgId}:${modelId}`;
}

function probeKey(orgId: string, modelId: string): string {
  return `model.capability.probe.v1:${orgId}:${modelId}`;
}

export async function readModelProbeTimestamps(
  repository: RomeoRepository,
  orgId: string,
): Promise<Map<string, string>> {
  const probes = new Map<string, string>();
  const prefix = `model.capability.probe.v1:${orgId}:`;
  for (const setting of await repository.listSystemSettings()) {
    if (!setting.key.startsWith(prefix)) continue;
    const value = setting.value;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      continue;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.schema !== PROBE_SCHEMA ||
      candidate.orgId !== orgId ||
      typeof candidate.probedAt !== "string" ||
      typeof candidate.modelId !== "string"
    )
      continue;
    probes.set(candidate.modelId, candidate.probedAt);
  }
  return probes;
}
