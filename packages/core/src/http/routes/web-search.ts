import {
  getWebSearchConfigurationRoute,
  ingestWebUrlsRoute,
  searchWebRoute,
  updateWebSearchConfigurationRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerWebSearchRoutes(app: RomeoApi): void {
  app.openapi(getWebSearchConfigurationRoute, async (context) => {
    const data = await context
      .get("services")
      .webSearch.configuration(context.get("subject"));
    return context.json({ data }, 200);
  });

  app.openapi(updateWebSearchConfigurationRoute, async (context) => {
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .webSearch.updateConfiguration(context.get("subject"), {
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(body.provider === undefined ? {} : { provider: body.provider }),
        ...(body.endpointUrl === undefined
          ? {}
          : { endpointUrl: body.endpointUrl }),
        ...(body.credentialRef === undefined
          ? {}
          : { credentialRef: body.credentialRef }),
        ...(body.allowedDomains === undefined
          ? {}
          : { allowedDomains: body.allowedDomains }),
        ...(body.blockedDomains === undefined
          ? {}
          : { blockedDomains: body.blockedDomains }),
        ...(body.maxResults === undefined
          ? {}
          : { maxResults: body.maxResults }),
        ...(body.freshnessMaxAgeDays === undefined
          ? {}
          : { freshnessMaxAgeDays: body.freshnessMaxAgeDays }),
        ...(body.unknownPublicationDatePolicy === undefined
          ? {}
          : {
              unknownPublicationDatePolicy: body.unknownPublicationDatePolicy,
            }),
        ...(body.unreachableUrlPolicy === undefined
          ? {}
          : { unreachableUrlPolicy: body.unreachableUrlPolicy }),
      });
    return context.json({ data }, 200);
  });

  app.openapi(searchWebRoute, async (context) => {
    const { query } = context.req.valid("json");
    const data = await context
      .get("services")
      .webSearch.search(context.get("subject"), query);
    return context.json({ data }, 200);
  });

  app.openapi(ingestWebUrlsRoute, async (context) => {
    const body = context.req.valid("json");
    const services = context.get("services");
    const subject = context.get("subject");
    const items = await services.webSearch.ingestUrls(subject, body.urls);
    const data =
      body.saveToLibrary === true && body.workspaceId !== undefined
        ? await Promise.all(
            items.map(async (item) => {
              const bytes = Buffer.from(item.content, "utf8");
              const file = await services.files.create(subject, {
                workspaceId: body.workspaceId!,
                fileName: `${safeSourceName(item.title)}.md`,
                mimeType: "text/markdown",
                sizeBytes: bytes.byteLength,
                dataBase64: bytes.toString("base64"),
                purpose: "web_source",
                metadata: {
                  sourceUri: item.url,
                  accessedAt: item.accessedAt,
                },
              });
              return { ...item, fileId: file.id };
            }),
          )
        : items;
    return context.json({ data }, 200);
  });
}

function safeSourceName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 120) || "web-source"
  );
}
