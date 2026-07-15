import { z } from 'zod'

import type { ToolDefinition } from '../types'

export const dateTimeInputSchema = z.object({
  timeZone: z.string().default('UTC')
})

export const dateTimeOutputSchema = z.object({
  iso: z.string(),
  timeZone: z.string()
})

export const dateTimeTool: ToolDefinition<typeof dateTimeInputSchema, typeof dateTimeOutputSchema> = {
  id: 'tool_datetime',
  name: 'Date/time',
  description: 'Returns the current time for a requested time zone.',
  riskLevel: 'low',
  requiredScopes: ['tools:use'],
  approvalPolicy: 'never',
  timeoutMs: 1000,
  inputSchema: dateTimeInputSchema,
  outputSchema: dateTimeOutputSchema,
  async execute(input) {
    return {
      iso: new Date().toISOString(),
      timeZone: input.timeZone
    }
  }
}
