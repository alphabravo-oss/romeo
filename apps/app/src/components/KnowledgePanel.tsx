import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import Upload from 'lucide-react/dist/esm/icons/upload.mjs'

import {
  createKnowledgeBase,
  createKnowledgeSource,
  deleteKnowledgeSource,
  extractKnowledgeSource,
  listKnowledgeBases,
  listKnowledgeSources,
  queryKnowledgeBase,
  reindexKnowledgeSource
} from '../api/client'
import { toast } from '../lib/toast'
import type { Agent, RetrievalHit } from '../api/types'
import { PanelState } from '../lib/panel-state'
import { AgentKnowledgeBindingControls } from './AgentKnowledgeBindingControls'
import { FormDialog } from './FormDialog'
import { KnowledgeSourceList } from './KnowledgeSourceList'
import { PanelStats } from './PanelStats'
import { Tabs } from './Tabs'

export function KnowledgePanel({ activeAgent, workspaceId }: { activeAgent: Agent | undefined; workspaceId: string | undefined }) {
  const queryClient = useQueryClient()
  const [activeKnowledgeBaseId, setActiveKnowledgeBaseId] = useState<string>()
  const [hits, setHits] = useState<RetrievalHit[]>([])
  const [notice, setNotice] = useState<string>()
  const [baseDialogOpen, setBaseDialogOpen] = useState(false)
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false)

  const knowledgeBasesQuery = useQuery({
    queryKey: ['knowledgeBases', workspaceId],
    queryFn: () => listKnowledgeBases(workspaceId!),
    enabled: workspaceId !== undefined
  })
  const knowledgeBases = useMemo(() => knowledgeBasesQuery.data ?? [], [knowledgeBasesQuery.data])
  const activeKnowledgeBase = knowledgeBases.find((item) => item.id === activeKnowledgeBaseId) ?? knowledgeBases[0]
  const sourcesQuery = useQuery({
    queryKey: ['knowledgeSources', activeKnowledgeBase?.id],
    queryFn: () => listKnowledgeSources(activeKnowledgeBase!.id),
    enabled: activeKnowledgeBase !== undefined
  })

  const createBaseMutation = useMutation({ mutationFn: createKnowledgeBase })
  const createSourceMutation = useMutation({ mutationFn: createKnowledgeSource })
  const deleteSourceMutation = useMutation({ mutationFn: deleteKnowledgeSource })
  const extractSourceMutation = useMutation({ mutationFn: extractKnowledgeSource })
  const reindexSourceMutation = useMutation({ mutationFn: reindexKnowledgeSource })
  const queryMutation = useMutation({ mutationFn: queryKnowledgeBase })

  useEffect(() => {
    if (activeKnowledgeBaseId === undefined && knowledgeBases[0]) setActiveKnowledgeBaseId(knowledgeBases[0].id)
  }, [activeKnowledgeBaseId, knowledgeBases])

  const KnowledgeBaseForm = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      if (!workspaceId) return

      try {
        const created = await createBaseMutation.mutateAsync({ workspaceId, name: value.name })
        setActiveKnowledgeBaseId(created.id)
        setNotice('Knowledge base created.')
        await queryClient.invalidateQueries({ queryKey: ['knowledgeBases', workspaceId] })
        toast('Knowledge base created', 'success')
        setBaseDialogOpen(false)
      } catch {
        toast('Could not create knowledge base', 'error')
      }
    }
  })

  const SourceForm = useForm({
    defaultValues: {
      fileName: '',
      sourceContent: ''
    },
    onSubmit: async ({ value }) => {
      if (!activeKnowledgeBase) return

      const content = value.sourceContent.trim()
      const input = {
        knowledgeBaseId: activeKnowledgeBase.id,
        fileName: value.fileName,
        mimeType: mimeTypeFor(value.fileName),
        sizeBytes: Math.max(1, content.length || value.fileName.length * 16)
      }
      try {
        await createSourceMutation.mutateAsync(content.length > 0 ? { ...input, content } : input)
        setNotice('Source registered for ingestion.')
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['knowledgeSources', activeKnowledgeBase.id] }),
          queryClient.invalidateQueries({ queryKey: ['usageEvents'] }),
          queryClient.invalidateQueries({ queryKey: ['usageSummary'] }),
          queryClient.invalidateQueries({ queryKey: ['usageAlerts'] }),
          queryClient.invalidateQueries({ queryKey: ['quotas'] })
        ])
        toast('Knowledge source added', 'success')
        setSourceDialogOpen(false)
      } catch {
        toast('Could not add knowledge source', 'error')
      }
    }
  })

  async function handleSourceFileChange(file: File | undefined) {
    if (file === undefined) return
    const mimeType = mimeTypeFor(file.name, file.type)
    SourceForm.setFieldValue('fileName', file.name)
    if (!canInlineUpload(mimeType)) {
      SourceForm.setFieldValue('sourceContent', '')
      setNotice('This file type requires upload registration and the extraction worker.')
      return
    }
    if (file.size > 200_000) {
      SourceForm.setFieldValue('sourceContent', '')
      setNotice('Inline file import supports text files up to 200 KB.')
      return
    }
    SourceForm.setFieldValue('sourceContent', await file.text())
    setNotice('Local file loaded.')
  }

  const QueryForm = useForm({
    defaultValues: { query: '' },
    onSubmit: async ({ value }) => {
      if (!activeKnowledgeBase) return

      const results = await queryMutation.mutateAsync({ knowledgeBaseId: activeKnowledgeBase.id, query: value.query })
      setHits(results)
      setNotice('Knowledge query completed.')
    }
  })

  async function handleDeleteSource(sourceId: string) {
    if (!activeKnowledgeBase) return
    try {
      await deleteSourceMutation.mutateAsync({ knowledgeBaseId: activeKnowledgeBase.id, sourceId })
      setHits([])
      setNotice('Source deleted.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['knowledgeSources', activeKnowledgeBase.id] }),
        queryClient.invalidateQueries({ queryKey: ['usageEvents'] }),
        queryClient.invalidateQueries({ queryKey: ['usageSummary'] }),
        queryClient.invalidateQueries({ queryKey: ['usageAlerts'] })
      ])
      toast('Knowledge source deleted', 'success')
    } catch {
      toast('Could not delete knowledge source', 'error')
    }
  }

  async function handleReindexSource(sourceId: string) {
    if (!activeKnowledgeBase) return
    const content = SourceForm.state.values.sourceContent.trim()
    if (content.length === 0) return

    try {
      const source = await reindexSourceMutation.mutateAsync({
        knowledgeBaseId: activeKnowledgeBase.id,
        sourceId,
        content,
        sizeBytes: content.length
      })
      setHits([])
      setNotice(`Source reindexed: ${source.chunkCount ?? 0} chunks.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['knowledgeSources', activeKnowledgeBase.id] }),
        queryClient.invalidateQueries({ queryKey: ['usageEvents'] }),
        queryClient.invalidateQueries({ queryKey: ['usageSummary'] }),
        queryClient.invalidateQueries({ queryKey: ['usageAlerts'] }),
        queryClient.invalidateQueries({ queryKey: ['jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['quotas'] })
      ])
      toast('Knowledge source reindexed', 'success')
    } catch {
      toast('Could not reindex knowledge source', 'error')
    }
  }

  async function handleExtractSource(sourceId: string) {
    if (!activeKnowledgeBase) return
    try {
      const result = await extractSourceMutation.mutateAsync({ knowledgeBaseId: activeKnowledgeBase.id, sourceId })
      setHits([])
      setNotice(`Extraction ${result.job.status}: ${result.source.chunkCount ?? 0} chunks.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['knowledgeSources', activeKnowledgeBase.id] }),
        queryClient.invalidateQueries({ queryKey: ['usageEvents'] }),
        queryClient.invalidateQueries({ queryKey: ['usageSummary'] }),
        queryClient.invalidateQueries({ queryKey: ['usageAlerts'] }),
        queryClient.invalidateQueries({ queryKey: ['jobs'] })
      ])
      toast('Knowledge source extracted', 'success')
    } catch {
      toast('Could not extract knowledge source', 'error')
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Knowledge</div>
        <div className="flex gap-2">
          <button className="rm-button primary" onClick={() => setBaseDialogOpen(true)} type="button">
            + Add knowledge base
          </button>
          <button
            className="rm-button primary"
            disabled={!activeKnowledgeBase}
            onClick={() => setSourceDialogOpen(true)}
            type="button"
          >
            + Add source
          </button>
        </div>
      </div>

      <FormDialog onClose={() => setBaseDialogOpen(false)} open={baseDialogOpen} title="New knowledge base">
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void KnowledgeBaseForm.handleSubmit()
          }}
        >
          <label className="text-sm text-muted" htmlFor="knowledge-name">
            Knowledge base
          </label>
          <KnowledgeBaseForm.Field
            name="name"
            validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Name is required' : undefined) }}
          >
            {(field) => (
              <>
                <input
                  className="rm-input"
                  id="knowledge-name"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  placeholder="Knowledge base name"
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
                ) : null}
              </>
            )}
          </KnowledgeBaseForm.Field>
          <button className="rm-button" disabled={!workspaceId || createBaseMutation.isPending} type="submit">
            {createBaseMutation.isPending ? 'Creating' : 'Create KB'}
          </button>
        </form>
      </FormDialog>

      <FormDialog onClose={() => setSourceDialogOpen(false)} open={sourceDialogOpen} title="Add source">
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void SourceForm.handleSubmit()
          }}
        >
          <label className="text-sm text-muted" htmlFor="knowledge-file-name">
            Source file
          </label>
          <label className="rm-button inline-flex cursor-pointer items-center justify-center gap-2" htmlFor="knowledge-file-picker">
            <Upload size={16} />
            <span>Choose file</span>
          </label>
          <input
            accept=".txt,.md,.markdown,.json,.jsonl,.ndjson,.csv,.html,.htm,text/*,application/json,application/x-ndjson"
            className="sr-only"
            id="knowledge-file-picker"
            onChange={(event) => void handleSourceFileChange(event.currentTarget.files?.[0])}
            type="file"
          />
          <SourceForm.Field name="fileName">
            {(field) => (
              <input
                className="rm-input"
                id="knowledge-file-name"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Source file name"
                value={field.state.value}
              />
            )}
          </SourceForm.Field>
          <label className="text-sm text-muted" htmlFor="knowledge-source-content">
            Source text
          </label>
          <SourceForm.Field name="sourceContent">
            {(field) => (
              <textarea
                className="rm-input min-h-24"
                id="knowledge-source-content"
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Source text"
                value={field.state.value}
              />
            )}
          </SourceForm.Field>
          <button className="rm-button" disabled={!activeKnowledgeBase || createSourceMutation.isPending} type="submit">
            {createSourceMutation.isPending ? 'Registering' : 'Register source'}
          </button>
        </form>
      </FormDialog>

      <Tabs
        tabs={[
          {
            id: 'sources',
            label: 'Sources',
            content: (
              <div className="grid gap-4">
                <div className="grid gap-2 text-sm">
                  {knowledgeBases.map((knowledgeBase) => (
                    <button
                      className={`rm-button min-w-0 text-left ${knowledgeBase.id === activeKnowledgeBase?.id ? 'selected' : ''}`}
                      key={knowledgeBase.id}
                      onClick={() => setActiveKnowledgeBaseId(knowledgeBase.id)}
                      type="button"
                    >
                      <span className="block truncate">{knowledgeBase.name}</span>
                    </button>
                  ))}
                </div>

                <AgentKnowledgeBindingControls activeAgent={activeAgent} activeKnowledgeBase={activeKnowledgeBase} />

                <PanelState
                  query={sourcesQuery}
                  empty="No knowledge sources yet."
                  emptyAction={
                    <button className="rm-button primary" disabled={!activeKnowledgeBase} onClick={() => setSourceDialogOpen(true)} type="button">
                      + Add source
                    </button>
                  }
                >
                  {(sources) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: 'Total sources', value: sources.length },
                { label: 'Knowledge bases', value: knowledgeBases.length },
                { label: 'Indexed', value: sources.filter((source) => source.status === 'indexed').length },
              ]}
            />
            <KnowledgeSourceList
              isDeleting={deleteSourceMutation.isPending}
              isExtracting={extractSourceMutation.isPending}
              isReindexing={reindexSourceMutation.isPending}
              onDelete={(sourceId) => void handleDeleteSource(sourceId)}
              onExtract={(sourceId) => void handleExtractSource(sourceId)}
              onReindex={(sourceId) => void handleReindexSource(sourceId)}
              sources={sources}
            />
          </div>
        )}
                </PanelState>
              </div>
            )
          },
          {
            id: 'query',
            label: 'Query',
            content: (
              <div>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void QueryForm.handleSubmit()
        }}
      >
        <label className="text-sm text-muted" htmlFor="knowledge-query">
          Query
        </label>
        <QueryForm.Field name="query">
          {(field) => (
            <input
              className="rm-input"
              id="knowledge-query"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              placeholder="Ask a question"
              value={field.state.value}
            />
          )}
        </QueryForm.Field>
        <button className="rm-button" disabled={!activeKnowledgeBase || queryMutation.isPending} type="submit">
          {queryMutation.isPending ? 'Querying' : 'Query KB'}
        </button>
      </form>

      {notice ? <div className="mt-3 text-sm text-muted">{notice}</div> : null}
      <div className="mt-2 grid gap-2 text-sm">
        {hits.map((hit) => (
          <div className="rounded-md border border-border p-2" key={hit.id}>
            <div className="font-medium">{hit.citation.title}</div>
            <div className="line-clamp-3 text-muted">{hit.content}</div>
          </div>
        ))}
      </div>
              </div>
            )
          }
        ]}
      />
    </section>
  )
}

function mimeTypeFor(fileName: string, reportedType = ''): string {
  if (reportedType.length > 0) return reportedType
  if (fileName.endsWith('.md')) return 'text/markdown'
  if (fileName.endsWith('.markdown')) return 'text/markdown'
  if (fileName.endsWith('.json')) return 'application/json'
  if (fileName.endsWith('.jsonl') || fileName.endsWith('.ndjson')) return 'application/x-ndjson'
  if (fileName.endsWith('.csv')) return 'text/csv'
  if (fileName.endsWith('.html') || fileName.endsWith('.htm')) return 'text/html'
  if (fileName.endsWith('.pdf')) return 'application/pdf'
  return 'text/plain'
}

function canInlineUpload(mimeType: string): boolean {
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return normalized.startsWith('text/') || normalized === 'application/json' || normalized === 'application/x-ndjson'
}
