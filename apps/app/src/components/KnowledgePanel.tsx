import { Input, Textarea, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import Upload from "lucide-react/dist/esm/icons/upload.mjs";

import {
  createKnowledgeBase,
  createKnowledgeSource,
  deleteKnowledgeSource,
  extractKnowledgeSource,
  listKnowledgeBases,
  listKnowledgeSources,
  queryKnowledgeBase,
  reindexKnowledgeSource,
} from "../features";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { formatNumber } from "../lib/locale-format";
import type { Agent, KnowledgeSource, RetrievalHit } from "../features/types";
import { useConfirm } from "./ConfirmDialog";
import { FormDialog } from "./FormDialog";
import { Tabs } from "./Tabs";
import { KnowledgeSourcesTab } from "./KnowledgeSourcesTab";
import {
  canInlineUpload,
  knowledgeJobStatusKey,
  mimeTypeFor,
} from "./knowledge-file-utils";
import { isReindexPayloadCoherent } from "./knowledge-reindex";

export function KnowledgePanel({
  activeAgent,
  workspaceId,
}: {
  activeAgent: Agent | undefined;
  workspaceId: string | undefined;
}) {
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const [activeKnowledgeBaseId, setActiveKnowledgeBaseId] = useState<string>();
  const [hits, setHits] = useState<RetrievalHit[]>([]);
  const [notice, setNotice] = useState<string>();
  const [baseDialogOpen, setBaseDialogOpen] = useState(false);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [reindexing, setReindexing] = useState<KnowledgeSource>();
  const { ask, dialog } = useConfirm();

  const knowledgeBasesQuery = useQuery({
    queryKey: ["knowledgeBases", workspaceId],
    queryFn: () => listKnowledgeBases(workspaceId!),
    enabled: workspaceId !== undefined,
  });
  const knowledgeBases = useMemo(
    () => knowledgeBasesQuery.data ?? [],
    [knowledgeBasesQuery.data],
  );
  const activeKnowledgeBase =
    knowledgeBases.find((item) => item.id === activeKnowledgeBaseId) ??
    knowledgeBases[0];
  const sourcesQuery = useQuery({
    queryKey: ["knowledgeSources", activeKnowledgeBase?.id],
    queryFn: () => listKnowledgeSources(activeKnowledgeBase!.id),
    enabled: activeKnowledgeBase !== undefined,
  });

  const createBaseMutation = useMutation({ mutationFn: createKnowledgeBase });
  const createSourceMutation = useMutation({
    mutationFn: createKnowledgeSource,
  });
  const deleteSourceMutation = useMutation({
    mutationFn: deleteKnowledgeSource,
  });
  const extractSourceMutation = useMutation({
    mutationFn: extractKnowledgeSource,
  });
  const reindexSourceMutation = useMutation({
    mutationFn: reindexKnowledgeSource,
  });
  const queryMutation = useMutation({ mutationFn: queryKnowledgeBase });

  useEffect(() => {
    if (activeKnowledgeBaseId === undefined && knowledgeBases[0])
      setActiveKnowledgeBaseId(knowledgeBases[0].id);
  }, [activeKnowledgeBaseId, knowledgeBases]);

  const KnowledgeBaseForm = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      if (!workspaceId) return;

      try {
        const created = await createBaseMutation.mutateAsync({
          workspaceId,
          name: value.name,
        });
        setActiveKnowledgeBaseId(created.id);
        setNotice(t("knowledgeBaseCreatedNotice"));
        await queryClient.invalidateQueries({
          queryKey: ["knowledgeBases", workspaceId],
        });
        toast(t("knowledgeBaseCreated"), "success");
        setBaseDialogOpen(false);
      } catch {
        toast(t("knowledgeCouldNotCreateBase"), "error");
      }
    },
  });

  const SourceForm = useForm({
    defaultValues: {
      fileName: "",
      sourceContent: "",
    },
    onSubmit: async ({ value }) => {
      if (!activeKnowledgeBase) return;

      const content = value.sourceContent.trim();
      const input = {
        knowledgeBaseId: activeKnowledgeBase.id,
        fileName: value.fileName,
        mimeType: mimeTypeFor(value.fileName),
        sizeBytes: Math.max(1, content.length || value.fileName.length * 16),
      };
      try {
        await createSourceMutation.mutateAsync(
          content.length > 0 ? { ...input, content } : input,
        );
        setNotice(t("knowledgeSourceRegistered"));
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["knowledgeSources", activeKnowledgeBase.id],
          }),
          queryClient.invalidateQueries({ queryKey: ["usageEvents"] }),
          queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
          queryClient.invalidateQueries({ queryKey: ["usageAlerts"] }),
          queryClient.invalidateQueries({ queryKey: ["quotas"] }),
        ]);
        toast(t("knowledgeSourceAdded"), "success");
        setSourceDialogOpen(false);
      } catch {
        toast(t("knowledgeCouldNotAddSource"), "error");
      }
    },
  });

  const ReindexForm = useForm({
    defaultValues: {
      content: "",
      payloadSourceId: undefined as string | undefined,
    },
    onSubmit: async ({ value }) => {
      if (!activeKnowledgeBase || !reindexing) return;
      const content = value.content.trim();
      if (
        content.length === 0 ||
        !isReindexPayloadCoherent({
          sourceId: reindexing.id,
          payloadSourceId: value.payloadSourceId,
        })
      )
        return;
      if (
        !(await ask({
          title: t("knowledgeReindexTitle"),
          body: `${reindexing.fileName}: ${t("knowledgeReindexBody")}`,
          confirmLabel: t("knowledgeReindex"),
          tone: "danger",
        }))
      )
        return;

      try {
        const source = await reindexSourceMutation.mutateAsync({
          knowledgeBaseId: activeKnowledgeBase.id,
          sourceId: reindexing.id,
          content,
          sizeBytes: content.length,
        });
        setHits([]);
        setNotice(
          `${t("knowledgeSourceReindexedNotice")}: ${formatNumber(source.chunkCount ?? 0, locale)} ${t("knowledgeChunksLower")}.`,
        );
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["knowledgeSources", activeKnowledgeBase.id],
          }),
          queryClient.invalidateQueries({ queryKey: ["usageEvents"] }),
          queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
          queryClient.invalidateQueries({ queryKey: ["usageAlerts"] }),
          queryClient.invalidateQueries({ queryKey: ["jobs"] }),
          queryClient.invalidateQueries({ queryKey: ["quotas"] }),
        ]);
        toast(t("knowledgeSourceReindexed"), "success");
        setReindexing(undefined);
        ReindexForm.reset();
      } catch {
        toast(t("knowledgeCouldNotReindexSource"), "error");
      }
    },
  });

  async function handleSourceFileChange(file: File | undefined) {
    if (file === undefined) return;
    const mimeType = mimeTypeFor(file.name, file.type);
    SourceForm.setFieldValue("fileName", file.name);
    if (!canInlineUpload(mimeType)) {
      SourceForm.setFieldValue("sourceContent", "");
      setNotice(t("knowledgeFileWorkerRequired"));
      return;
    }
    if (file.size > 200_000) {
      SourceForm.setFieldValue("sourceContent", "");
      setNotice(t("knowledgeInlineLimit"));
      return;
    }
    SourceForm.setFieldValue("sourceContent", await file.text());
    setNotice(t("knowledgeFileLoaded"));
  }

  const QueryForm = useForm({
    defaultValues: { query: "" },
    onSubmit: async ({ value }) => {
      if (!activeKnowledgeBase) return;

      const results = await queryMutation.mutateAsync({
        knowledgeBaseId: activeKnowledgeBase.id,
        query: value.query,
      });
      setHits(results);
      setNotice(t("knowledgeQueryComplete"));
    },
  });

  async function handleDeleteSource(sourceId: string) {
    if (!activeKnowledgeBase) return;
    const source = sourcesQuery.data?.find((item) => item.id === sourceId);
    if (!source) return;
    if (
      !(await ask({
        title: t("knowledgeDeleteTitle"),
        body: `${source.fileName}: ${t("knowledgeDeleteBody")}`,
        confirmLabel: t("knowledgeDelete"),
        tone: "danger",
      }))
    )
      return;
    try {
      await deleteSourceMutation.mutateAsync({
        knowledgeBaseId: activeKnowledgeBase.id,
        sourceId,
      });
      setHits([]);
      setNotice(t("knowledgeSourceDeletedNotice"));
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["knowledgeSources", activeKnowledgeBase.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["usageEvents"] }),
        queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
        queryClient.invalidateQueries({ queryKey: ["usageAlerts"] }),
      ]);
      toast(t("knowledgeSourceDeleted"), "success");
    } catch {
      toast(t("knowledgeCouldNotDeleteSource"), "error");
    }
  }

  function handleReindexSource(sourceId: string) {
    const source = sourcesQuery.data?.find((item) => item.id === sourceId);
    if (!source) return;
    ReindexForm.reset({ content: "", payloadSourceId: source.id });
    setReindexing(source);
  }

  async function handleExtractSource(sourceId: string) {
    if (!activeKnowledgeBase) return;
    try {
      const result = await extractSourceMutation.mutateAsync({
        knowledgeBaseId: activeKnowledgeBase.id,
        sourceId,
      });
      setHits([]);
      setNotice(
        `${t("knowledgeExtraction")} ${t(knowledgeJobStatusKey(result.job.status))}: ${formatNumber(result.source.chunkCount ?? 0, locale)} ${t("knowledgeChunksLower")}.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["knowledgeSources", activeKnowledgeBase.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["usageEvents"] }),
        queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
        queryClient.invalidateQueries({ queryKey: ["usageAlerts"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
      toast(t("knowledgeExtracted"), "success");
    } catch {
      toast(t("knowledgeCouldNotExtractSource"), "error");
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("knowledgeTitle")}</div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => setBaseDialogOpen(true)}
            type="button"
          >
            + {t("knowledgeAddBase")}
          </Button>
          <Button
            variant="primary"
            disabled={!activeKnowledgeBase}
            onClick={() => setSourceDialogOpen(true)}
            type="button"
          >
            + {t("knowledgeAddSource")}
          </Button>
        </div>
      </div>

      <FormDialog
        onClose={() => setBaseDialogOpen(false)}
        open={baseDialogOpen}
        title={t("knowledgeNewBase")}
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void KnowledgeBaseForm.handleSubmit();
          }}
        >
          <label className="text-sm text-muted" htmlFor="knowledge-name">
            {t("knowledgeBase")}
          </label>
          <KnowledgeBaseForm.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("knowledgeNameRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Input
                  name="name"
                  id="knowledge-name"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("knowledgeBaseName")}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </KnowledgeBaseForm.Field>
          <Button
            disabled={!workspaceId || createBaseMutation.isPending}
            type="submit"
          >
            {createBaseMutation.isPending
              ? t("knowledgeCreating")
              : t("knowledgeCreateBase")}
          </Button>
        </form>
      </FormDialog>

      <FormDialog
        onClose={() => setSourceDialogOpen(false)}
        open={sourceDialogOpen}
        title={t("knowledgeAddSource")}
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void SourceForm.handleSubmit();
          }}
        >
          <label className="text-sm text-muted" htmlFor="knowledge-file-name">
            {t("knowledgeSourceFile")}
          </label>
          <label
            className="inline-flex cursor-pointer items-center justify-center gap-2"
            htmlFor="knowledge-file-picker"
          >
            <Upload size={16} />
            <span>{t("knowledgeChooseFile")}</span>
          </label>
          <Input
            name="knowledge-file-picker"
            accept=".txt,.md,.markdown,.json,.jsonl,.ndjson,.csv,.html,.htm,text/*,application/json,application/x-ndjson"
            className="sr-only"
            id="knowledge-file-picker"
            onChange={(event) =>
              void handleSourceFileChange(event.currentTarget.files?.[0])
            }
            type="file"
          />
          <SourceForm.Field name="fileName">
            {(field) => (
              <Input
                name="fileName"
                id="knowledge-file-name"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("knowledgeSourceFileName")}
                value={field.state.value}
              />
            )}
          </SourceForm.Field>
          <label
            className="text-sm text-muted"
            htmlFor="knowledge-source-content"
          >
            {t("knowledgeSourceText")}
          </label>
          <SourceForm.Field name="sourceContent">
            {(field) => (
              <Textarea
                name="sourceContent"
                className="min-h-24"
                id="knowledge-source-content"
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("knowledgeSourceText")}
                value={field.state.value}
              />
            )}
          </SourceForm.Field>
          <Button
            disabled={!activeKnowledgeBase || createSourceMutation.isPending}
            type="submit"
          >
            {createSourceMutation.isPending
              ? t("knowledgeRegistering")
              : t("knowledgeRegisterSource")}
          </Button>
        </form>
      </FormDialog>

      <FormDialog
        {...(reindexing === undefined
          ? {}
          : {
              description: `${reindexing.fileName}: ${t("knowledgeReindexBody")}`,
            })}
        onClose={() => {
          setReindexing(undefined);
          ReindexForm.reset();
        }}
        open={reindexing !== undefined}
        title={t("knowledgeReindexTitle")}
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void ReindexForm.handleSubmit();
          }}
        >
          <label
            className="text-sm text-muted"
            htmlFor="knowledge-reindex-content"
          >
            {t("knowledgeSourceText")}
          </label>
          <ReindexForm.Field
            name="content"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value.trim() ? t("knowledgeSourceText") : undefined,
            }}
          >
            {(field) => (
              <Textarea
                name="content"
                className="min-h-36"
                id="knowledge-reindex-content"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                value={field.state.value}
              />
            )}
          </ReindexForm.Field>
          <Button
            disabled={reindexSourceMutation.isPending}
            pending={reindexSourceMutation.isPending}
            type="submit"
          >
            {t("knowledgeReindex")}
          </Button>
        </form>
      </FormDialog>

      <Tabs
        tabs={[
          {
            id: "sources",
            label: t("knowledgeSources"),
            content: (
              <KnowledgeSourcesTab
                activeAgent={activeAgent}
                activeKnowledgeBase={activeKnowledgeBase}
                isDeleting={deleteSourceMutation.isPending}
                isExtracting={extractSourceMutation.isPending}
                isReindexing={reindexSourceMutation.isPending}
                knowledgeBases={knowledgeBases}
                onAddSource={() => setSourceDialogOpen(true)}
                onDelete={(sourceId) => void handleDeleteSource(sourceId)}
                onExtract={(sourceId) => void handleExtractSource(sourceId)}
                onReindex={handleReindexSource}
                onSelect={setActiveKnowledgeBaseId}
                sourcesQuery={sourcesQuery}
              />
            ),
          },
          {
            id: "query",
            label: t("knowledgeQuery"),
            content: (
              <div>
                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void QueryForm.handleSubmit();
                  }}
                >
                  <label
                    className="text-sm text-muted"
                    htmlFor="knowledge-query"
                  >
                    {t("knowledgeQuery")}
                  </label>
                  <QueryForm.Field name="query">
                    {(field) => (
                      <Input
                        name="query"
                        id="knowledge-query"
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.currentTarget.value)
                        }
                        placeholder={t("knowledgeAskQuestion")}
                        value={field.state.value}
                      />
                    )}
                  </QueryForm.Field>
                  <Button
                    disabled={!activeKnowledgeBase || queryMutation.isPending}
                    type="submit"
                  >
                    {queryMutation.isPending
                      ? t("knowledgeQuerying")
                      : t("knowledgeQueryBase")}
                  </Button>
                </form>

                {notice ? (
                  <div className="mt-3 text-sm text-muted">{notice}</div>
                ) : null}
                <div className="mt-2 grid gap-2 text-sm">
                  {hits.map((hit) => (
                    <div
                      className="rounded-md border border-border p-2"
                      key={hit.id}
                    >
                      <div className="font-medium">{hit.citation.title}</div>
                      <div className="line-clamp-3 text-muted">
                        {hit.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ),
          },
        ]}
      />
      {dialog}
    </section>
  );
}
