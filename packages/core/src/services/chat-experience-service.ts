import { assertScope, type AuthSubject } from "@romeo/auth";
import type {
  ChatExperience,
  ChatSuggestion,
  UpdateChatExperience,
} from "@romeo/contracts";

import type { RomeoRepository } from "../domain/repository";
import { writeAuditLog } from "./audit-log";

const defaultSuggestions: ChatSuggestion[] = [
  {
    title: "Draft a secure Milestone 1 rollout plan",
    prompt:
      "Draft a secure rollout plan for Milestone 1, including phases, owners, controls, rollback criteria, and validation gates.",
  },
  {
    title: "Summarize workspace risks",
    prompt:
      "Summarize the most important risks across this workspace's agents, models, tools, knowledge, and data. Prioritize the findings and recommend mitigations.",
  },
  {
    title: "Create a go-live operator checklist",
    prompt:
      "Create an operator checklist for go-live readiness, organized by preflight, launch, validation, monitoring, rollback, and sign-off.",
  },
];

const defaults: ChatExperience = {
  suggestions: defaultSuggestions,
  autoTitleEnabled: true,
  // Bare chat is the default: unless an operator opts in, the model answers as itself.
  assistantsEnabled: false,
};

export class ChatExperienceService {
  constructor(private readonly repository: RomeoRepository) {}

  async get(subject: AuthSubject): Promise<ChatExperience> {
    assertScope(subject, "chats:read");
    const value =
      (await this.repository.getSystemSetting(settingKey(subject.orgId)))
        ?.value ?? {};
    return normalize(value);
  }

  async update(
    subject: AuthSubject,
    input: UpdateChatExperience,
  ): Promise<ChatExperience> {
    assertScope(subject, "admin:write");
    // A body without `assistantsEnabled` — anything written against the pre-toggle contract — keeps
    // whatever is stored. Falling back to the default here instead would let an old client silently
    // switch assistants off for the whole org just by saving its suggestions.
    const assistantsEnabled =
      input.assistantsEnabled ??
      (await assistantsEnabledForOrg(this.repository, subject.orgId));
    const data = normalize({ ...input, assistantsEnabled });
    const now = new Date().toISOString();
    await this.repository.transaction(async (repository) => {
      await repository.upsertSystemSetting({
        key: settingKey(subject.orgId),
        value: structuredClone(data),
        updatedAt: now,
      });
      await writeAuditLog(repository, {
        subject,
        action: "chat_experience.update",
        resourceType: "organization",
        resourceId: subject.orgId,
        metadata: {
          assistantsEnabled: data.assistantsEnabled,
          autoTitleEnabled: data.autoTitleEnabled,
          suggestionCount: data.suggestions.length,
        },
      });
    });
    return data;
  }
}

/**
 * The run path's read of the same org row the admin screen writes. No scope assert and no subject:
 * this is a property of the organization, not of the caller, and every caller has already
 * authorized the run it is assembling. Reading through `normalize` keeps one definition of the
 * default, so an org that never opened the screen reads bare here exactly as it does in the API.
 */
export async function assistantsEnabledForOrg(
  repository: RomeoRepository,
  orgId: string,
): Promise<boolean> {
  const value = (await repository.getSystemSetting(settingKey(orgId)))?.value;
  return normalize(value ?? {}).assistantsEnabled;
}

function settingKey(orgId: string): string {
  return `chat_experience.v1:${orgId}`;
}

function normalize(value: Record<string, unknown>): ChatExperience {
  const suggestions = Array.isArray(value.suggestions)
    ? value.suggestions
        .flatMap((candidate): ChatSuggestion[] => {
          if (typeof candidate !== "object" || candidate === null) return [];
          const title = Reflect.get(candidate, "title");
          const prompt = Reflect.get(candidate, "prompt");
          if (typeof title !== "string" || typeof prompt !== "string")
            return [];
          const normalizedTitle = title.trim().slice(0, 80);
          const normalizedPrompt = prompt.trim().slice(0, 4_000);
          if (normalizedTitle.length === 0 || normalizedPrompt.length === 0)
            return [];
          return [{ title: normalizedTitle, prompt: normalizedPrompt }];
        })
        .slice(0, 8)
    : defaults.suggestions;
  return {
    suggestions,
    autoTitleEnabled:
      typeof value.autoTitleEnabled === "boolean"
        ? value.autoTitleEnabled
        : defaults.autoTitleEnabled,
    // Rows persisted before this field existed have no `assistantsEnabled`, so they land on the
    // default and read as bare. The key stays `chat_experience.v1` — bumping it would orphan every
    // org's saved suggestions to buy nothing.
    assistantsEnabled:
      typeof value.assistantsEnabled === "boolean"
        ? value.assistantsEnabled
        : defaults.assistantsEnabled,
  };
}
