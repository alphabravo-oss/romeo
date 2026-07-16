// The seed attaches tool_calculator and tool_datetime to agent_default but
// ships them DISABLED, because an agent that advertises tools by default breaks
// the README's Ollama quick start (see repositories/seed-data.ts for the two
// model failures). A test that executes or advertises a tool must therefore
// state that precondition itself instead of inheriting a seed default —
// otherwise it pins the seed rather than the behaviour under test.

import type { InMemoryRomeoRepository } from "../repositories/in-memory";

interface TestApi {
  request(path: string, init?: RequestInit): Response | Promise<Response>;
}

/** Enable a tool on agent_default through the agent-tools management route. */
export async function enableDefaultAgentTool(
  api: TestApi,
  toolId: string,
  options: { approvalRequired?: boolean } = {},
): Promise<void> {
  const response = await api.request(
    `/api/v1/agents/agent_default/tools/${toolId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, ...options }),
    },
  );
  if (response.status !== 200) {
    throw new Error(
      `failed to enable ${toolId}: ${response.status} ${await response.text()}`,
    );
  }
}

/** Enable a tool on agent_default directly, for tests that skip the HTTP layer. */
export async function enableAgentToolBinding(
  repository: InMemoryRomeoRepository,
  toolId: string,
): Promise<void> {
  const binding = (await repository.listAgentToolBindings("agent_default")).find(
    (candidate) => candidate.toolId === toolId,
  );
  if (binding === undefined) throw new Error(`Missing ${toolId} binding`);
  await repository.upsertAgentToolBinding({
    ...binding,
    enabled: true,
    updatedAt: new Date().toISOString(),
  });
}
