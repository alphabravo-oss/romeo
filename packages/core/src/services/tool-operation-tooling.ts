import type { ProviderToolDefinition } from "@romeo/providers";
import type { ToolDefinition } from "@romeo/tools";
import { z } from "zod";

import type { ToolConnector, ToolOperation } from "../domain/entities";

const operationInputSchema = z
  .object({
    parameters: z.record(z.string(), z.unknown()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const operationOutputSchema = z.record(z.string(), z.unknown());

export type OperationToolInput = z.infer<typeof operationInputSchema>;

export function createOperationToolDefinition(
  connector: ToolConnector,
  operation: ToolOperation,
): ToolDefinition<typeof operationInputSchema, typeof operationOutputSchema> {
  return {
    id: operation.id,
    name: `${connector.name}: ${operation.name}`,
    description:
      operation.description ||
      `${operation.method.toUpperCase()} ${operation.path}`,
    riskLevel: operation.riskLevel,
    requiredScopes: ["tools:use"],
    approvalPolicy: operation.approvalPolicy,
    timeoutMs: 0,
    inputSchema: operationInputSchema,
    outputSchema: operationOutputSchema,
    async execute() {
      throw new Error(
        "Imported OpenAPI operations execute through dispatch requests.",
      );
    },
  };
}

export function parseOperationToolInput(input: unknown): OperationToolInput {
  return operationInputSchema.parse(input);
}

export function buildOperationProviderToolDefinition(
  connector: ToolConnector,
  operation: ToolOperation,
): ProviderToolDefinition {
  return {
    name: operation.id,
    description:
      operation.description || `${connector.name}: ${operation.name}`,
    parameters: operationProviderParameters(operation),
  };
}

function operationProviderParameters(
  operation: ToolOperation,
): Record<string, unknown> {
  const parameterSchema = declaredParameterSchema(operation);
  const bodySchema = declaredBodySchema(operation);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (parameterSchema !== undefined) {
    properties.parameters = parameterSchema.schema;
    if (parameterSchema.required) required.push("parameters");
  }
  if (bodySchema !== undefined) {
    properties.body = bodySchema.schema;
    if (bodySchema.required) required.push("body");
  }

  return {
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: false,
  };
}

function declaredParameterSchema(
  operation: ToolOperation,
): { required: boolean; schema: Record<string, unknown> } | undefined {
  const parameters = Array.isArray(operation.inputSchema.parameters)
    ? operation.inputSchema.parameters
    : [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const parameter of parameters) {
    if (!isRecord(parameter) || typeof parameter.name !== "string") continue;
    if (parameter.in !== "path" && parameter.in !== "query") continue;
    properties[parameter.name] = jsonSchemaSubset(parameter.schema);
    if (parameter.required === true || parameter.in === "path")
      required.push(parameter.name);
  }
  if (Object.keys(properties).length === 0) return undefined;
  return {
    required: required.length > 0,
    schema: {
      type: "object",
      properties,
      ...(required.length === 0 ? {} : { required }),
      additionalProperties: false,
    },
  };
}

function declaredBodySchema(
  operation: ToolOperation,
): { required: boolean; schema: Record<string, unknown> } | undefined {
  const requestBody = isRecord(operation.inputSchema.requestBody)
    ? operation.inputSchema.requestBody
    : undefined;
  if (requestBody === undefined) return undefined;
  const content = isRecord(requestBody.content) ? requestBody.content : {};
  const jsonContent = isRecord(content["application/json"])
    ? content["application/json"]
    : undefined;
  const schema = jsonSchemaSubset(jsonContent?.schema);
  return {
    required: requestBody.required === true,
    schema:
      Object.keys(schema).length === 0
        ? { type: "object", additionalProperties: true }
        : schema,
  };
}

function jsonSchemaSubset(value: unknown, depth = 0): Record<string, unknown> {
  if (!isRecord(value) || depth > 4) return {};
  const schema: Record<string, unknown> = {};
  if (isSafeJsonSchemaType(value.type)) schema.type = value.type;
  if (
    typeof value.format === "string" &&
    /^[A-Za-z0-9_.-]{1,80}$/u.test(value.format)
  )
    schema.format = value.format;
  if (typeof value.minimum === "number") schema.minimum = value.minimum;
  if (typeof value.maximum === "number") schema.maximum = value.maximum;
  if (typeof value.minLength === "number") schema.minLength = value.minLength;
  if (typeof value.maxLength === "number") schema.maxLength = value.maxLength;
  if (Array.isArray(value.enum)) {
    const enumValues = value.enum.filter(isPrimitiveJsonValue).slice(0, 50);
    if (enumValues.length > 0) schema.enum = enumValues;
  }
  if (Array.isArray(value.required)) {
    const required = value.required.filter(
      (item): item is string => typeof item === "string",
    );
    if (required.length > 0) schema.required = required;
  }
  if (isRecord(value.properties)) {
    const properties: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(value.properties).slice(
      0,
      100,
    )) {
      properties[key] = jsonSchemaSubset(property, depth + 1);
    }
    schema.properties = properties;
  }
  if (isRecord(value.items))
    schema.items = jsonSchemaSubset(value.items, depth + 1);
  if (typeof value.additionalProperties === "boolean") {
    schema.additionalProperties = value.additionalProperties;
  } else if (isRecord(value.additionalProperties)) {
    schema.additionalProperties = jsonSchemaSubset(
      value.additionalProperties,
      depth + 1,
    );
  }
  return schema;
}

function isSafeJsonSchemaType(value: unknown): value is string {
  return (
    value === "array" ||
    value === "boolean" ||
    value === "integer" ||
    value === "number" ||
    value === "object" ||
    value === "string"
  );
}

function isPrimitiveJsonValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
