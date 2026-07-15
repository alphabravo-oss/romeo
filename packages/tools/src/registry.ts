import { calculatorTool } from './built-ins/calculator'
import { dateTimeTool } from './built-ins/date-time'
import type { ToolDefinition } from './types'

export const builtInTools = [calculatorTool, dateTimeTool] satisfies ToolDefinition[]

export function listBuiltInTools(): ToolDefinition[] {
  return builtInTools
}
