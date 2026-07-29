import {
  generateChatTitleRoute,
  getChatExperienceRoute,
  updateChatExperienceRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

const titleSystemPrompt = [
  "Create a concise title for this conversation.",
  "Return only the title: no JSON, quotes, markdown, or punctuation suffix.",
  "Use 2 to 6 words and no more than 80 characters.",
  "Preserve important product or project names.",
].join(" ");

export function registerChatExperienceRoutes(app: RomeoApi): void {
  app.openapi(getChatExperienceRoute, async (context) => {
    const data = await context
      .get("services")
      .chatExperience.get(context.get("subject"));
    return context.json({ data }, 200);
  });

  app.openapi(updateChatExperienceRoute, async (context) => {
    const data = await context
      .get("services")
      .chatExperience.update(context.get("subject"), context.req.valid("json"));
    return context.json({ data }, 200);
  });

  app.openapi(generateChatTitleRoute, async (context) => {
    const subject = context.get("subject");
    const services = context.get("services");
    const chatId = context.req.valid("param").chatId;
    const chat = await services.chats.get(chatId, subject);
    const settings = await services.chatExperience.get(subject);
    if (!settings.autoTitleEnabled) return context.json({ data: chat }, 200);

    const messages = await services.chats.messages(chatId, subject);
    const firstUserMessage = messages.find(
      (message) => message.role === "user" && message.content.trim().length > 0,
    );
    if (firstUserMessage === undefined)
      return context.json({ data: chat }, 200);

    const body = context.req.valid("json");
    const completion = await services.openAiChatCompletions.complete({
      subject,
      request: {
        model: body.modelId,
        messages: [
          { role: "system", content: titleSystemPrompt },
          {
            role: "user",
            content: firstUserMessage.content.slice(0, 8_000),
          },
        ],
      },
    });
    const generated = completion.choices[0]?.message.content ?? "";
    const data = await services.chats.update({
      subject,
      chatId,
      title: normalizeGeneratedTitle(generated, firstUserMessage.content),
    });
    services.chatEvents.publish({
      action: "updated",
      chatId: data.id,
      orgId: subject.orgId,
      workspaceId: data.workspaceId,
    });
    return context.json({ data }, 200);
  });
}

function normalizeGeneratedTitle(generated: string, fallback: string): string {
  let value = generated.trim();
  if (value.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null) {
        const title = Reflect.get(parsed, "title");
        if (typeof title === "string") value = title;
      }
    } catch {
      // Treat non-JSON provider output as a plain-text title.
    }
  }
  value = value
    .split(/\r?\n/u)[0]!
    .replace(/^#+\s*/u, "")
    .replace(/^title:\s*/iu, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "")
    .trim();
  if (/^Romeo .+ response:/u.test(value)) value = "";
  if (value.length === 0) value = fallbackTitle(fallback);
  return value.split(/\s+/u).slice(0, 6).join(" ").slice(0, 80).trim();
}

function fallbackTitle(content: string): string {
  const words = content
    .trim()
    .replace(/\s+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .slice(0, 6);
  const title = words.join(" ").replace(/[.!?,:;]+$/gu, "");
  return title.length > 0 ? title.slice(0, 80) : "New conversation";
}
