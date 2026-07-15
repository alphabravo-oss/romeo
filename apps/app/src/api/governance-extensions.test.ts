import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDataExportPackage,
  deleteDataExportPackage,
  downloadDataExportPackageContent,
  enforceRetention,
  executeDataExport,
  exportAccessReviewReportCsv,
  getAccessReviewReport,
  getDataRightsCoverage,
  listDataExportPackages,
  previewDataExport
} from './admin-client'

function mockFetch(returnBody: unknown = { data: {} }) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => returnBody, text: async () => 'body-text' }) as unknown as Response)
  vi.stubGlobal('fetch', fn)
  return fn
}

function lastCall(fn: ReturnType<typeof mockFetch>) {
  const call = fn.mock.calls.at(-1)
  const url = call?.[0] ?? ''
  const init = call?.[1] ?? {}
  return {
    url,
    method: init.method,
    body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('admin-client — governance retention enforcement', () => {
  it('enforceRetention POSTs the enforce route', async () => {
    const fn = mockFetch({ data: { orgId: 'o1', auditLogRetentionDays: 365, cutoffAt: 'x', deletedAuditLogCount: 3, enforcedAt: 'y' } })
    const result = await enforceRetention()
    expect(lastCall(fn).url).toBe('/api/v1/governance/retention/enforce')
    expect(lastCall(fn).method).toBe('POST')
    expect(result.deletedAuditLogCount).toBe(3)
  })
})

describe('admin-client — data rights coverage', () => {
  it('getDataRightsCoverage GETs the coverage route', async () => {
    const fn = mockFetch({ data: { schema: 'romeo.data-rights-coverage.v1', orgId: 'o1', storageClasses: [], openGaps: [] } })
    await getDataRightsCoverage()
    expect(lastCall(fn).url).toBe('/api/v1/governance/data-rights/coverage')
    expect(lastCall(fn).method).toBeUndefined()
  })
})

describe('admin-client — data exports', () => {
  it('previewDataExport POSTs the preview route with the request', async () => {
    const fn = mockFetch({ data: {} })
    await previewDataExport({ scope: 'org' })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/governance/data-exports/preview')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ scope: 'org' })
  })

  it('executeDataExport POSTs the execute route', async () => {
    const fn = mockFetch({ data: {} })
    await executeDataExport({ scope: 'workspace', workspaceId: 'ws1' })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/governance/data-exports/execute')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ scope: 'workspace', workspaceId: 'ws1' })
  })

  it('listDataExportPackages GETs the packages route', async () => {
    const fn = mockFetch({ data: { packages: [] } })
    await listDataExportPackages()
    expect(lastCall(fn).url).toBe('/api/v1/governance/data-exports/packages')
    expect(lastCall(fn).method).toBeUndefined()
  })

  it('createDataExportPackage POSTs the packages route', async () => {
    const fn = mockFetch({ data: { packageId: 'pkg1' } })
    const created = await createDataExportPackage({ scope: 'org', includeContent: true })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/governance/data-exports/packages')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ scope: 'org', includeContent: true })
    expect(created.packageId).toBe('pkg1')
  })

  it('deleteDataExportPackage DELETEs the package with the confirm guard (id url-encoded)', async () => {
    const fn = mockFetch({ data: {} })
    await deleteDataExportPackage({ packageId: 'pkg 1', confirmPackageId: 'pkg 1' })
    const call = lastCall(fn)
    expect(call.url).toBe('/api/v1/governance/data-exports/packages/pkg%201')
    expect(call.method).toBe('DELETE')
    expect(call.body).toEqual({ confirmPackageId: 'pkg 1' })
  })

  it('downloadDataExportPackageContent fetches the content route and returns text', async () => {
    const fn = mockFetch()
    const text = await downloadDataExportPackageContent('pkg1')
    expect(lastCall(fn).url).toBe('/api/v1/governance/data-exports/packages/pkg1/content')
    expect(text).toBe('body-text')
  })
})

describe('admin-client — access review report', () => {
  it('getAccessReviewReport GETs the report route', async () => {
    const fn = mockFetch({ data: { schema: 'romeo.access-review-report.v1', orgId: 'o1', summary: {}, resourceGrants: [] } })
    await getAccessReviewReport()
    expect(lastCall(fn).url).toBe('/api/v1/access-review/report')
    expect(lastCall(fn).method).toBeUndefined()
  })

  it('exportAccessReviewReportCsv fetches the report.csv route and returns text', async () => {
    const fn = mockFetch()
    const csv = await exportAccessReviewReportCsv()
    expect(lastCall(fn).url).toBe('/api/v1/access-review/report.csv')
    expect(csv).toBe('body-text')
  })
})
