import {
  listManagedModelKnowledgeBindingsRoute,
  updateManagedModelKnowledgeBindingRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerAgentKnowledgeRoutes(app: RomeoApi): void {
  app.openapi(listManagedModelKnowledgeBindingsRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .agentKnowledge.list(agentId, subject);
    return context.json({ data }, 200);
  });

  app.openapi(updateManagedModelKnowledgeBindingRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId, knowledgeBaseId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").agentKnowledge.update({
      subject,
      agentId,
      knowledgeBaseId,
      enabled: body.enabled,
    });
    return context.json({ data }, 200);
  });
}
