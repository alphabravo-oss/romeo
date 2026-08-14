import type { AuthSubject } from "@romeo/auth";
import type { OpenAPIHono } from "@hono/zod-openapi";

import type { RomeoServices } from "../services";

export interface AppBindings {
  Variables: {
    requestId: string;
    secureCookie: boolean;
    traceId: string;
    subject: AuthSubject;
    services: RomeoServices;
  };
}

export type RomeoApi = OpenAPIHono<AppBindings>;
