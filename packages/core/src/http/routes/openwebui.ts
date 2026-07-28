import type { Context } from "hono";
import {
  getOpenWebUiConfigAliasRoute,
  getOpenWebUiConfigRoute,
  getOpenWebUiSessionUserRoute,
  getOpenWebUiVersionAliasRoute,
  getOpenWebUiVersionRoute,
  getOpenWebUiVersionUpdatesAliasRoute,
  getOpenWebUiVersionUpdatesRoute,
} from "@romeo/contracts";

import type { AppBindings, RomeoApi } from "../context";
import { registerOpenWebUiChannelRoutes } from "./openwebui-channels";
import { registerOpenWebUiChatRoutes } from "./openwebui-chats";

export function registerOpenWebUiRoutes(app: RomeoApi): void {
  app.openapi(getOpenWebUiSessionUserRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.sessionUser(context.get("subject"));
    return context.json(data, 200);
  });
  registerOpenWebUiChatRoutes(app);
  registerOpenWebUiChannelRoutes(app);
  app.openapi(getOpenWebUiConfigRoute, handleConfig);
  app.openapi(getOpenWebUiVersionRoute, handleVersion);
  app.openapi(getOpenWebUiVersionUpdatesRoute, handleVersionUpdates);
  app.openapi(getOpenWebUiConfigAliasRoute, handleConfig);
  app.openapi(getOpenWebUiVersionAliasRoute, handleVersion);
  app.openapi(getOpenWebUiVersionUpdatesAliasRoute, handleVersionUpdates);
}

function handleConfig(context: Context<AppBindings>) {
  return context.json(
    context.get("services").openWebUiCompatibility.config(),
    200,
  );
}

function handleVersion(context: Context<AppBindings>) {
  return context.json(
    context.get("services").openWebUiCompatibility.version(),
    200,
  );
}

function handleVersionUpdates(context: Context<AppBindings>) {
  return context.json(
    context.get("services").openWebUiCompatibility.versionUpdates(),
    200,
  );
}
