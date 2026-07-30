import { Input, Textarea, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Upload from "lucide-react/dist/esm/icons/upload.mjs";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";

import {
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
import { KnowledgeQueryTab } from "./KnowledgeQueryTab";
import { KnowledgeCatalogPage } from "./KnowledgeCatalogPage";
import { KnowledgeBaseSummary } from "./KnowledgeBaseSummary";
import {
  canInlineUpload,
  knowledgeJobStatusKey,
  mimeTypeFor,
} from "./knowledge-file-utils";
import { isReindexPayloadCoherent } from "./knowledge-reindex";

export function KnowledgePanel({
  activeAgent,
  onSelectionChange,
  selectedKnowledgeBaseId,
  workspaceId,
}: {
  activeAgent: Agent | undefined;
  onSelectionChange: (knowledgeBaseId: string | null) => void;
  selectedKnowledgeBaseId: string | undefined;
  workspaceId: string | undefined;
}) {
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const [hits, setHits] = useState<RetrievalHit[]>([]);
  const [notice, setNotice] = useState<string>();
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
  const activeKnowledgeBase = knowledgeBases.find(
    (item) => item.id === selectedKnowledgeBaseId,
  );
  const sourcesQuery = useQuery({
    queryKey: ["knowledgeSources", activeKnowledgeBase?.id],
    queryFn: () => listKnowledgeSources(activeKnowledgeBase!.id),
    enabled: activeKnowledgeBase !== undefined,
  });

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

  async function handleQuery(query: string) {
    if (!activeKnowledgeBase) return;
    const results = await queryMutation.mutateAsync({
      knowledgeBaseId: activeKnowledgeBase.id,
      query,
    });
    setHits(results);
    setNotice(t("knowledgeQueryComplete"));
  }

  async function handleDeleteSource(sourceId: string) {
    if (!activeKnowledgeBase) return;
    const source = sourcesQuery.data?.find((item) => item.id === sourceId);
    if (!source) return;
    if (
      !(await ask({
        title: t("knowledgeDeleteTitle"),
        body: `${source.fileName}: ${t("knowledgeDeleteBody")} ${t(
          "knowledgeDeleteImpact",
          {
            agents: activeKnowledgeBase.dependentAgentCount ?? 0,
            sources: activeKnowledgeBase.sourceCount ?? 0,
          },
        )}`,
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

  if (activeKnowledgeBase === undefined) {
    return (
      <KnowledgeCatalogPage
        isLoading={knowledgeBasesQuery.isLoading}
        knowledgeBases={knowledgeBases}
        onCreated={(knowledgeBaseId) => {
          onSelectionChange(knowledgeBaseId);
          setNotice(t("knowledgeBaseCreatedNotice"));
        }}
        onSelectionChange={onSelectionChange}
        workspaceId={workspaceId}
      />
    );
  }

  return (
    <div className="grid gap-3">
      <Button
        className="w-fit"
        onClick={() => onSelectionChange(null)}
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        {t("knowledgeBackToBases")}
      </Button>
      <section className="rm-panel p-4">
        <KnowledgeBaseSummary
          knowledgeBase={activeKnowledgeBase}
          onAddSource={() => setSourceDialogOpen(true)}
        />

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
                  onAddSource={() => setSourceDialogOpen(true)}
                  onDelete={(sourceId) => void handleDeleteSource(sourceId)}
                  onExtract={(sourceId) => void handleExtractSource(sourceId)}
                  onReindex={handleReindexSource}
                  sourcesQuery={sourcesQuery}
                />
              ),
            },
            {
              id: "query",
              label: t("knowledgeQuery"),
              content: (
                <KnowledgeQueryTab
                  enabled={activeKnowledgeBase !== undefined}
                  hits={hits}
                  isPending={queryMutation.isPending}
                  notice={notice}
                  onQuery={handleQuery}
                />
              ),
            },
          ]}
        />
        {dialog}
      </section>
    </div>
  );
}
