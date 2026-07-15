import type { DataConnector, LocalImportSyncItem } from '../domain/entities'
import { ApiError } from '../errors'
import type { DataConnectorExecutionResult, DataConnectorExecutor } from './data-connector-executors'
import { retryConnectorResponse, type DataConnectorRetryPolicy } from './data-connector-retry'
import type { SecretResolver } from './secret-resolver'

export interface DelegatedOAuthConnectorCredentialProvider {
  getConnectorAccessToken(input: { connectionId: string; connector: DataConnector }): Promise<string>
}

interface GitHubTreeItem {
  path?: unknown
  size?: unknown
  type?: unknown
}

interface GitHubTreeResponse {
  tree?: unknown
  truncated?: unknown
}

export class GitHubDataConnectorExecutor implements DataConnectorExecutor {
  private readonly fetchImpl: typeof fetch
  private readonly maxBytes: number
  private readonly maxItems: number
  private readonly secretResolver: SecretResolver | undefined
  private readonly delegatedOAuthCredentials: DelegatedOAuthConnectorCredentialProvider | undefined
  private readonly retryPolicy: DataConnectorRetryPolicy
  private readonly timeoutMs: number
  private readonly token: string | undefined

  constructor(options: { delegatedOAuthCredentials?: DelegatedOAuthConnectorCredentialProvider; fetchImpl?: typeof fetch; maxBytes?: number; maxItems?: number; retryAttempts?: number; retryBackoffMs?: number; secretResolver?: SecretResolver; timeoutMs?: number; token?: string } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.delegatedOAuthCredentials = options.delegatedOAuthCredentials
    this.maxBytes = options.maxBytes ?? 2_000_000
    this.maxItems = options.maxItems ?? 50
    this.retryPolicy = {
      retryAttempts: options.retryAttempts ?? 1,
      retryBackoffMs: options.retryBackoffMs ?? 250
    }
    this.secretResolver = options.secretResolver
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.token = options.token === undefined || options.token.length === 0 ? undefined : options.token
  }

  async sync(connector: DataConnector): Promise<DataConnectorExecutionResult> {
    if (connector.type !== 'github') throw new ApiError('connector_execution_disabled', 'Connector execution is disabled for this connector type.', 409)
    const config = readGitHubConfig(connector)
    const maxItems = Math.min(config.maxItems, this.maxItems)
    const token = await this.connectorToken(connector, config)
    const tree = await this.fetchTree(config, token)
    const files = tree
      .filter((item) => item.type === 'blob' && typeof item.path === 'string')
      .map((item) => ({ path: item.path as string, size: typeof item.size === 'number' ? item.size : undefined }))
      .filter((item) => pathIsInsidePrefix(item.path, config.pathPrefix))
      .filter((item) => supportedTextPath(item.path))
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, maxItems)

    if (files.length === 0) return { items: [], summary: summary(config, 0, 0) }

    const items: LocalImportSyncItem[] = []
    let totalBytes = 0
    for (const file of files) {
      if (file.size !== undefined && file.size > this.maxBytes) throw new ApiError('connector_response_too_large', 'GitHub file exceeds the configured size limit.', 413)
      const fetched = await this.fetchFile(config, file.path, token)
      if (fetched.sizeBytes > this.maxBytes) throw new ApiError('connector_response_too_large', 'GitHub file exceeds the configured size limit.', 413)
      totalBytes += fetched.sizeBytes
      items.push({
        fileName: githubFileName(file.path, config.pathPrefix),
        mimeType: mimeTypeFromPath(file.path),
        content: fetched.content,
        sizeBytes: fetched.sizeBytes
      })
    }

    return { items, summary: summary(config, items.length, totalBytes) }
  }

  private async fetchTree(config: GitHubConnectorConfig, token: string | undefined): Promise<GitHubTreeItem[]> {
    const response = await this.fetchGitHub(githubTreeUrl(config), token)
    if (!response.ok) throw new ApiError('connector_fetch_failed', 'GitHub connector tree fetch failed.', 502, { status: response.status })
    const body = (await response.json()) as GitHubTreeResponse
    if (body.truncated === true) throw new ApiError('connector_item_limit_exceeded', 'GitHub connector tree is too large to sync safely.', 413)
    if (!Array.isArray(body.tree)) throw new ApiError('connector_fetch_failed', 'GitHub connector tree response is invalid.', 502)
    return body.tree.filter((item): item is GitHubTreeItem => typeof item === 'object' && item !== null)
  }

  private async fetchFile(config: GitHubConnectorConfig, path: string, token: string | undefined): Promise<{ content: string; sizeBytes: number }> {
    const response = await this.fetchGitHub(githubContentUrl(config, path), token, { accept: 'application/vnd.github.raw' })
    if (!response.ok) throw new ApiError('connector_fetch_failed', 'GitHub connector file fetch failed.', 502, { status: response.status })
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      throw new ApiError('connector_response_too_large', 'GitHub file exceeds the configured size limit.', 413)
    }
    const body = await response.arrayBuffer()
    if (body.byteLength > this.maxBytes) throw new ApiError('connector_response_too_large', 'GitHub file exceeds the configured size limit.', 413)
    return { content: new TextDecoder().decode(body), sizeBytes: body.byteLength }
  }

  private async connectorToken(connector: DataConnector, config: GitHubConnectorConfig): Promise<string | undefined> {
    if (config.delegatedOAuthConnectionId !== undefined) {
      if (this.delegatedOAuthCredentials === undefined) {
        throw new ApiError('connector_delegated_oauth_unsupported', 'GitHub delegated OAuth credentials require delegated OAuth support.', 409)
      }
      return this.delegatedOAuthCredentials.getConnectorAccessToken({
        connectionId: config.delegatedOAuthConnectionId,
        connector
      })
    }
    if (config.secretRef === undefined) return this.token
    if (this.secretResolver?.resolveValue === undefined) {
      throw new ApiError('connector_github_secret_ref_unsupported', 'GitHub connector secret references require a value-capable secret resolver.', 409)
    }
    const resolution = await this.secretResolver.resolveValue(config.secretRef)
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError('connector_github_secret_ref_unavailable', 'GitHub connector secret reference is unavailable.', 409, {
        ...(resolution.failureCode === undefined ? {} : { failureCode: resolution.failureCode }),
        secretRefScheme: resolution.scheme
      })
    }
    return resolution.value
  }

  private async fetchGitHub(url: URL, token: string | undefined, headers: Record<string, string> = {}): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await retryConnectorResponse(
        () => this.fetchImpl(url.toString(), {
          headers: {
            accept: headers.accept ?? 'application/vnd.github+json',
            'user-agent': 'RomeoDataConnector/0.1',
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
          },
          redirect: 'manual',
          signal: controller.signal
        }),
        this.retryPolicy
      )
    } catch {
      throw new ApiError('connector_fetch_failed', 'GitHub connector fetch failed.', 502)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class RoutingDataConnectorExecutor implements DataConnectorExecutor {
  constructor(private readonly executors: Partial<Record<DataConnector['type'], DataConnectorExecutor>>) {}

  sync(connector: DataConnector): Promise<DataConnectorExecutionResult> {
    return (this.executors[connector.type] ?? disabledForType).sync(connector)
  }
}

const disabledForType: DataConnectorExecutor = {
  async sync() {
    throw new ApiError('connector_execution_disabled', 'Connector execution is disabled for this connector type.', 409)
  }
}

interface GitHubConnectorConfig {
  branch: string
  delegatedOAuthConnectionId?: string
  maxItems: number
  owner: string
  pathPrefix: string
  repo: string
  secretRef?: string
}

function readGitHubConfig(connector: DataConnector): GitHubConnectorConfig {
  const repository = stringConfig(connector, 'repository')
  const [owner, repo] = repository.split('/')
  if (owner === undefined || repo === undefined) throw new ApiError('invalid_connector_config', 'GitHub connector requires owner/repo.', 400)
  return {
    owner,
    repo,
    branch: stringConfig(connector, 'branch'),
    pathPrefix: stringConfig(connector, 'pathPrefix'),
    maxItems: numberConfig(connector, 'maxItems', 50),
    ...(typeof connector.config.secretRef === 'string' ? { secretRef: connector.config.secretRef } : {}),
    ...(typeof connector.config.delegatedOAuthConnectionId === 'string' ? { delegatedOAuthConnectionId: connector.config.delegatedOAuthConnectionId } : {})
  }
}

function stringConfig(connector: DataConnector, key: string): string {
  const value = connector.config[key]
  if (typeof value !== 'string') throw new ApiError('invalid_connector_config', `GitHub connector requires ${key}.`, 400)
  return value
}

function numberConfig(connector: DataConnector, key: string, fallback: number): number {
  const value = connector.config[key]
  return Number.isInteger(value) ? Number(value) : fallback
}

function githubTreeUrl(config: GitHubConnectorConfig): URL {
  return new URL(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/trees/${encodeURIComponent(config.branch)}?recursive=1`)
}

function githubContentUrl(config: GitHubConnectorConfig, path: string): URL {
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodePath(path)}`)
  url.searchParams.set('ref', config.branch)
  return url
}

function encodePath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function pathIsInsidePrefix(path: string, prefix: string): boolean {
  return prefix.length === 0 || path === prefix || path.startsWith(`${prefix}/`)
}

function supportedTextPath(path: string): boolean {
  return ['.md', '.markdown', '.txt', '.csv', '.json', '.ndjson', '.html', '.htm'].some((extension) => path.toLowerCase().endsWith(extension))
}

function mimeTypeFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown'
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.json') || lower.endsWith('.ndjson')) return 'application/json'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  return 'text/plain'
}

function githubFileName(path: string, prefix: string): string {
  const relative = prefix.length === 0 ? path : path.slice(prefix.length).replace(/^\/+/u, '')
  return (relative || path).replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120) || 'github-source.txt'
}

function summary(config: GitHubConnectorConfig, fileCount: number, totalByteLength: number): Record<string, unknown> {
  return {
    repository: `${config.owner}/${config.repo}`,
    branch: config.branch,
    pathPrefix: config.pathPrefix,
    fileCount,
    totalByteLength
  }
}
