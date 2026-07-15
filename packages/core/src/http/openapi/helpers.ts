export const jsonContent = (schema: object) => ({
  'application/json': { schema }
})

export const dataEnvelope = (schema: object) => ({
  type: 'object',
  required: ['data'],
  properties: { data: schema }
})

export const objectSchema = (description: string) => ({
  type: 'object',
  description,
  additionalProperties: true
})

export const arrayEnvelope = (description: string) => dataEnvelope({ type: 'array', items: objectSchema(description) })

export const success = (description: string, schema: object = objectSchema(description)) => ({
  description,
  content: jsonContent(dataEnvelope(schema))
})

export const created = (
  description: string,
  schema: object = objectSchema(description),
) => ({
  description,
  content: jsonContent(dataEnvelope(schema))
})

export const errorResponse = { $ref: '#/components/responses/Error' }
