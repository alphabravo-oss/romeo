import type { AuthSubject } from '@romeo/auth'
import type { OpenAPIHono } from '@hono/zod-openapi'

import type { RomeoServices } from '../services'

export interface AppBindings {
  Variables: {
    requestId: string
    subject: AuthSubject
    services: RomeoServices
  }
}

export type RomeoApi = OpenAPIHono<AppBindings>
