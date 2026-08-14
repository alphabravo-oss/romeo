import { enforceImageCapability } from "./capability-resolution-model";
import type {
  AuthorizeImageGenerationInput,
  EffectiveCapability,
  ResolveCapabilityInput,
  ResolveManyCapabilityInput,
} from "./capability-resolution-model";

type Resolver = (input: ResolveCapabilityInput) => Promise<EffectiveCapability>;

export function resolveManyCapabilities(
  input: ResolveManyCapabilityInput,
  resolve: Resolver,
): Promise<EffectiveCapability[]> {
  return Promise.all(
    [...new Set(input.capabilityIds)].map((capabilityId) =>
      resolve({
        subject: input.subject,
        capabilityId,
        workspaceId: input.workspaceId,
        ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
        ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
        ...(input.agentVersionId === undefined
          ? {}
          : { agentVersionId: input.agentVersionId }),
        ...(input.requested?.[capabilityId] === undefined
          ? {}
          : { requested: input.requested[capabilityId] }),
      }),
    ),
  );
}

export async function authorizeImageGenerationCapability(
  input: AuthorizeImageGenerationInput,
  resolve: Resolver,
): Promise<{ count: number }> {
  const effective = await resolve({
    subject: input.subject,
    capabilityId: "image_generation",
    workspaceId: input.workspaceId,
    modelId: input.modelId,
    requested: {
      selected: true,
      maxImagesPerRequest: input.count,
      allowedSizes: [input.size],
    },
  });
  return enforceImageCapability(effective, input);
}
