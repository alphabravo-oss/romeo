import type { ToolConnector, ToolOperation, ToolOperationTestDisabledReason, ToolOperationTestPreview } from '../domain/entities'
import { parseManagedSecretRef } from './secret-refs'

export interface ToolOperationTestInput {
  parameters?: Record<string, unknown>
  body?: Record<string, unknown>
}

export interface ToolOperationTestOptions {
  externalExecutionEnabled?: boolean
}

export function buildToolOperationTestPreview(
  connector: ToolConnector,
  operation: ToolOperation,
  input: ToolOperationTestInput,
  options: ToolOperationTestOptions = {}
): ToolOperationTestPreview {
  const disabledReasons = disabledExecutionReasons(connector, operation, options)

  return {
    connectorId: connector.id,
    operationId: operation.operationId,
    method: operation.method,
    pathTemplate: operation.path,
    riskLevel: operation.riskLevel,
    approvalPolicy: operation.approvalPolicy,
    readyForExecution: disabledReasons.length === 0,
    disabledReasons,
    executionPlan: buildExecutionPlan(connector, operation, disabledReasons, options),
    requestPreview: {
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      declaredPathParameters: declaredParameters(operation, 'path'),
      declaredQueryParameters: declaredParameters(operation, 'query'),
      authConfigured: connector.authConfig.configured === true,
      networkExecution: disabledReasons.length === 0 && options.externalExecutionEnabled === true ? 'worker_ready' : 'disabled'
    }
  }
}

function buildExecutionPlan(
  connector: ToolConnector,
  operation: ToolOperation,
  disabledReasons: ToolOperationTestDisabledReason[],
  options: ToolOperationTestOptions
): ToolOperationTestPreview['executionPlan'] {
  const secretRef = typeof connector.authConfig.secretRef === 'string' ? connector.authConfig.secretRef : undefined
  const secretRefScheme = secretRef === undefined ? undefined : safeSecretRefScheme(secretRef)
  const secretResolution: ToolOperationTestPreview['executionPlan']['secretResolution'] = {
    required: requiresAuth(connector),
    configured: connector.authConfig.configured === true
  }
  if (secretRefScheme !== undefined) secretResolution.scheme = secretRefScheme
  return {
    dispatch: disabledReasons.length === 0 ? 'ready_for_worker' : 'blocked',
    executionMode: options.externalExecutionEnabled === true ? 'external_worker' : 'dry_run_only',
    workerQueue: 'external_tool_operations',
    approvalRequired: operation.approvalPolicy !== 'never',
    requiredBeforeDispatch: [...disabledReasons],
    secretResolution,
    networkPolicy: {
      mode: connector.networkPolicy.mode,
      allowedHostCount: connector.networkPolicy.allowedHosts.length,
      allowPrivateNetwork: connector.networkPolicy.allowPrivateNetwork
    }
  }
}

function disabledExecutionReasons(connector: ToolConnector, operation: ToolOperation, options: ToolOperationTestOptions): ToolOperationTestDisabledReason[] {
  const reasons: ToolOperationTestDisabledReason[] = []
  if (!connector.enabled) reasons.push('connector_disabled')
  if (!operation.enabled) reasons.push('operation_disabled')
  if (!hasConnectorBaseUrl(connector)) reasons.push('base_url_missing')
  if (requiresAuth(connector) && connector.authConfig.configured !== true) reasons.push('auth_not_configured')
  if (connector.networkPolicy.mode !== 'allow_hosts' || connector.networkPolicy.allowedHosts.length === 0) reasons.push('network_policy_missing')
  if (options.externalExecutionEnabled !== true) reasons.push('external_execution_disabled')
  return reasons
}

function hasConnectorBaseUrl(connector: ToolConnector): boolean {
  return typeof connector.schema.baseUrl === 'string' && connector.schema.baseUrl.length > 0
}

function requiresAuth(connector: ToolConnector): boolean {
  return typeof connector.authConfig.type === 'string' && connector.authConfig.type !== 'none'
}

function safeSecretRefScheme(secretRef: string): string | undefined {
  try {
    return parseManagedSecretRef(secretRef).scheme
  } catch {
    return undefined
  }
}

function declaredParameters(operation: ToolOperation, location: string): string[] {
  const parameters = Array.isArray(operation.inputSchema.parameters) ? operation.inputSchema.parameters : []
  return parameters
    .filter((parameter) => isRecord(parameter) && parameter.in === location && typeof parameter.name === 'string')
    .map((parameter) => (parameter as { name: string }).name)
    .sort()
}

function sortedKeys(value: Record<string, unknown> | undefined): string[] {
  return value === undefined ? [] : Object.keys(value).sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
