import type { z } from 'zod'

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ToolApprovalPolicy = 'never' | 'write_operations' | 'external_side_effects' | 'always' | 'admin_only'

export interface ToolDefinition<TInput extends z.ZodType = z.ZodType, TOutput extends z.ZodType = z.ZodType> {
  id: string
  name: string
  description: string
  riskLevel: ToolRiskLevel
  requiredScopes: string[]
  approvalPolicy: ToolApprovalPolicy
  timeoutMs: number
  inputSchema: TInput
  outputSchema: TOutput
  execute(input: z.infer<TInput>): Promise<z.infer<TOutput>>
}
