import {
  generateChatTitleRoute,
  getChatExperienceRoute,
  updateChatExperienceRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
import { normalizeGeneratedTitle } from "../../services/chat-title-normalize";

const titleSystemPrompt = [
  "Create a concise title for this conversation.",
  "Return only plain words for the title.",
  "No JSON, quotes, markdown, code fences, language tags, or trailing punctuation.",
  "Never start with ``` or a programming language name alone.",
  "Use 2 to 6 words and no more than 80 characters.",
  "Name the user's topic, not the assistant's format (e.g. prefer 'Sample Python code' over 'python').",
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
    await services.chatEvents.publish({
      action: "updated",
      chatId: data.id,
      orgId: subject.orgId,
      workspaceId: data.workspaceId,
    });
    return context.json({ data }, 200);
  });
}
