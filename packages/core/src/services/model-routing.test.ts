import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { routeModelSelection } from "./model-routing";

describe("model routing", () => {
  it("selects the cheapest authorized capability-preserving model", async () => {
    const repository = new InMemoryRomeoRepository();
    const primary = required(
      await repository.getModel("model_openai_compatible_default"),
    );
    const provider = required(await repository.getProvider(primary.providerId));
    primary.pricing = { inputTokenUsd: 0.000_01, outputTokenUsd: 0.000_03 };
    await repository.upsertModels([primary]);
    const [economy] = await repository.upsertModels([
      {
        ...primary,
        id: "model_economy",
        name: "economy",
        displayName: "Economy",
        pricing: { inputTokenUsd: 0.000_001, outputTokenUsd: 0.000_002 },
      },
    ]);

    const routed = await routeModelSelection(repository, {
      agentId: "agent_default",
      chatId: "chat_default",
      mode: "economy",
      orgId: "org_default",
      primaryModel: primary,
      primaryProvider: provider,
      subject: seededSubject,
      workspaceId: "workspace_default",
    });

    expect(routed.model.id).toBe(economy?.id);
    expect(routed.decision).toMatchObject({
      candidateCount: 2,
      mode: "economy",
      requestedModelId: primary.id,
      selectedModelId: "model_economy",
    });
  });

  it("does not cross deployment boundaries or downgrade capabilities", async () => {
    const repository = new InMemoryRomeoRepository();
    const primary = required(
      await repository.getModel("model_openai_compatible_default"),
    );
    const provider = required(await repository.getProvider(primary.providerId));
    primary.pricing = { inputTokenUsd: 0.000_01, outputTokenUsd: 0.000_03 };
    await repository.upsertModels([primary]);
    const local = required(await repository.getModel("model_ollama_default"));
    local.pricing = { inputTokenUsd: 0, outputTokenUsd: 0 };
    await repository.upsertModels([
      local,
      {
        ...primary,
        id: "model_missing_streaming",
        capabilities: { ...primary.capabilities, streaming: false },
        pricing: { inputTokenUsd: 0, outputTokenUsd: 0 },
      },
    ]);

    const routed = await routeModelSelection(repository, {
      agentId: "agent_default",
      chatId: "chat_default",
      mode: "economy",
      orgId: "org_default",
      primaryModel: primary,
      primaryProvider: provider,
      subject: seededSubject,
      workspaceId: "workspace_default",
    });

    expect(routed.model.id).toBe(primary.id);
  });

  it("honors provider kill switches and explicit selected mode", async () => {
    const repository = new InMemoryRomeoRepository();
    const primary = required(
      await repository.getModel("model_openai_compatible_default"),
    );
    const provider = required(await repository.getProvider(primary.providerId));
    primary.pricing = { inputTokenUsd: 0.000_01, outputTokenUsd: 0.000_03 };
    await repository.upsertModels([
      primary,
      {
        ...primary,
        id: "model_cheaper",
        pricing: { inputTokenUsd: 0, outputTokenUsd: 0 },
      },
    ]);

    const selected = await routeModelSelection(repository, {
      agentId: "agent_default",
      chatId: "chat_default",
      mode: "selected",
      orgId: "org_default",
      primaryModel: primary,
      primaryProvider: provider,
      subject: seededSubject,
      workspaceId: "workspace_default",
    });
    const killed = await routeModelSelection(repository, {
      agentId: "agent_default",
      chatId: "chat_default",
      disabledProviderIds: new Set([provider.id]),
      mode: "economy",
      orgId: "org_default",
      primaryModel: primary,
      primaryProvider: provider,
      subject: seededSubject,
      workspaceId: "workspace_default",
    });

    expect(selected.model.id).toBe(primary.id);
    expect(killed.model.id).toBe(primary.id);
    expect(killed.decision.candidateCount).toBe(0);
  });
});

function required<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}
