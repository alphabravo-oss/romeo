import type { ToolOperation, ToolOperationDispatchResult } from '../domain/entities'

type SchemaValidation = ToolOperationDispatchResult['response']['schemaValidation']

export function validateToolOperationResponse(input: {
  body: Uint8Array
  contentType?: string
  operation: ToolOperation
  status: number
  truncated: boolean
}): SchemaValidation {
  const schema = responseJsonSchema(input.operation, input.status)
  if (schema === undefined) return { status: 'not_applicable' }
  if (input.truncated) return { status: 'skipped', errorCode: 'response_body_truncated' }
  if (input.contentType === undefined || !isJsonContentType(input.contentType)) {
    return { status: 'skipped', errorCode: 'response_content_type_unsupported' }
  }
  let parsed: unknown
  try {
    parsed = input.body.byteLength === 0 ? null : JSON.parse(new TextDecoder().decode(input.body))
  } catch {
    return { status: 'failed', errorCode: 'response_json_invalid' }
  }
  const errorCode = validateJsonSchemaSubset(parsed, schema, 0)
  return errorCode === undefined ? { status: 'passed' } : { status: 'failed', errorCode }
}

function responseJsonSchema(operation: ToolOperation, status: number): Record<string, unknown> | undefined {
  const responses = asRecord(operation.outputSchema)
  const response = asRecord(responses?.[String(status)] ?? responses?.default)
  const content = asRecord(response?.content)
  if (content === undefined) return undefined
  const jsonContent = asRecord(content['application/json']) ?? Object.entries(content)
    .find(([mediaType]) => isJsonContentType(mediaType))?.[1]
  return asRecord(asRecord(jsonContent)?.schema)
}

function validateJsonSchemaSubset(value: unknown, schema: Record<string, unknown>, depth: number): string | undefined {
  if (depth > 6) return 'response_schema_unsupported'
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined
  if (enumValues !== undefined && !enumValues.some((item) => JSON.stringify(item) === JSON.stringify(value))) return 'response_enum_mismatch'

  const type = schemaType(schema)
  if (type === undefined) return Object.keys(schema).length === 0 ? undefined : 'response_schema_unsupported'
  if (!matchesType(value, type)) return 'response_type_mismatch'
  if (type === 'object') {
    const record = asRecord(value)
    if (record === undefined) return 'response_type_mismatch'
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []
    if (required.some((key) => !(key in record))) return 'response_required_property_missing'
    const properties = asRecord(schema.properties)
    if (properties !== undefined) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (!(key in record)) continue
        const errorCode = validateJsonSchemaSubset(record[key], asRecord(childSchema) ?? {}, depth + 1)
        if (errorCode !== undefined) return errorCode
      }
    }
  }
  if (type === 'array' && Array.isArray(value)) {
    const itemSchema = asRecord(schema.items)
    if (itemSchema !== undefined) {
      for (const item of value) {
        const errorCode = validateJsonSchemaSubset(item, itemSchema, depth + 1)
        if (errorCode !== undefined) return errorCode
      }
    }
  }
  return undefined
}

function schemaType(schema: Record<string, unknown>): string | undefined {
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) return schema.type.find((item): item is string => typeof item === 'string')
  if (schema.properties !== undefined || schema.required !== undefined) return 'object'
  if (schema.items !== undefined) return 'array'
  return undefined
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'object') return asRecord(value) !== undefined
  if (type === 'array') return Array.isArray(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'null') return value === null
  return false
}

function isJsonContentType(contentType: string): boolean {
  const normalized = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return normalized === 'application/json' || normalized.endsWith('+json')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
