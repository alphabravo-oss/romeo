import { z } from 'zod'

import type { ToolDefinition } from '../types'
import { evaluateArithmetic } from './arithmetic-parser'

export const calculatorInputSchema = z.object({
  expression: z.string().min(1).max(128)
})

export const calculatorOutputSchema = z.object({
  result: z.number(),
  expression: z.string()
})

export const calculatorTool: ToolDefinition<typeof calculatorInputSchema, typeof calculatorOutputSchema> = {
  id: 'tool_calculator',
  name: 'Calculator',
  description: 'Evaluates a constrained arithmetic expression without dynamic code execution.',
  riskLevel: 'low',
  requiredScopes: ['tools:use'],
  approvalPolicy: 'never',
  timeoutMs: 1000,
  inputSchema: calculatorInputSchema,
  outputSchema: calculatorOutputSchema,
  async execute(input) {
    return {
      expression: input.expression,
      result: evaluateArithmetic(input.expression)
    }
  }
}
