import type { AuthSubject } from "@romeo/auth";
import type { ChatMessage } from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import {
  enforceContentPolicyStrings,
  enforceContentPolicyValue,
} from "./content-policy-service";
import { buildProviderToolDefinitions } from "./provider-tool-schemas";

export async function governRunProviderInputs(input: {
  agentId: string;
  messages: ChatMessage[];
  repository: RomeoRepository;
  subject: AuthSubject;
  toolOperationExecutionEnabled: boolean;
}) {
  const governedMessages = await enforceContentPolicyStrings(
    input.repository,
    input.subject,
    input.messages.map((message) => message.content),
  );
  const tools = await buildProviderToolDefinitions(
    input.repository,
    input.subject,
    input.agentId,
    {
      externalOperationExecutionEnabled: input.toolOperationExecutionEnabled,
    },
  );
  return {
    messages: input.messages.map((message, index) => ({
      ...message,
      content: governedMessages.contents[index]!,
    })),
    providerTools: (
      await enforceContentPolicyValue(input.repository, input.subject, tools)
    ).value,
  };
}
