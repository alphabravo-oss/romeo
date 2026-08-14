import { Input, Textarea, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Upload from "lucide-react/dist/esm/icons/upload.mjs";

import {
  createKnowledgeSourceMutationOptions,
  deleteKnowledgeSourceMutationOptions,
  extractKnowledgeSourceMutationOptions,
  ingestKnowledgeFileMutationOptions,
  knowledgeBasesQueryOptions,
  knowledgeIngestReadinessQueryOptions,
  knowledgeSourcesQueryOptions,
  queryKnowledgeBaseMutationOptions,
  reindexKnowledgeSourceMutationOptions,
} from "../features";
import { Section } from "./console";
import { ingestKnowledgeFile } from "./knowledge-file-ingest";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { formatNumber } from "../lib/locale-format";
import type { KnowledgeSource, RetrievalHit } from "../features/types";
import { useConfirm } from "./ConfirmDialog";
import { FormDialog } from "./FormDialog";
import {
  isSupportedKnowledgeMime,
  knowledgeJobStatusKey,
  KNOWLEDGE_FILE_ACCEPT,
  mimeTypeFor,
  shouldInlineKnowledgeFile,
} from "./knowledge-file-utils";
import { isReindexPayloadCoherent } from "./knowledge-reindex";
import { knowledgeSharesQueryOptions } from "../features/access/query-options";
import { KnowledgeWorkspaceTabs } from "./KnowledgeWorkspaceTabs";
import { KnowledgePanelHeader } from "./KnowledgePanelHeader";
import type { KnowledgePanelProps } from "./knowledge-panel-types";
import { KnowledgeCatalogBoundary } from "./KnowledgeCatalogBoundary";

export function KnowledgePanel({
  activeAgent,
  isAdmin = false,
  onSelectionChange,
  selectedKnowledgeBaseId,
  workspaceId,
}: KnowledgePanelProps) {
  const { locale, t } = useLocale();
  const [hits, setHits] = useState<RetrievalHit[]>([]);
  const [notice, setNotice] = useState<string>();
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File>();
  const [reindexing, setReindexing] = useState<KnowledgeSource>();
  const { ask, dialog } = useConfirm();

  const knowledgeBasesQuery = useQuery(knowledgeBasesQueryOptions(workspaceId));
  const knowledgeBases = useMemo(
    () => knowledgeBasesQuery.data ?? [],
    [knowledgeBasesQuery.data],
  );
  const activeKnowledgeBase = knowledgeBases.find(
    (item) => item.id === selectedKnowledgeBaseId,
  );
  const sourcesQuery = useQuery(
    knowledgeSourcesQueryOptions(activeKnowledgeBase?.id),
  );
  const sharesQuery = useQuery(
    knowledgeSharesQueryOptions(activeKnowledgeBase?.id, isAdmin),
  );
  const ingestQuery = useQuery(knowledgeIngestReadinessQueryOptions());
  const canUpload = ingestQuery.data?.ready === true;

  const createSourceMutation = useMutation(
    createKnowledgeSourceMutationOptions(),
  );
  const ingestFileMutation = useMutation(
    ingestKnowledgeFileMutationOptions(ingestKnowledgeFile),
  );
  const deleteSourceMutation = useMutation(
    deleteKnowledgeSourceMutationOptions(),
  );
  const extractSourceMutation = useMutation(
    extractKnowledgeSourceMutationOptions(),
  );
  const reindexSourceMutation = useMutation(
    reindexKnowledgeSourceMutationOptions(),
  );
  const queryMutation = useMutation(queryKnowledgeBaseMutationOptions());

  const SourceForm = useForm({
    defaultValues: {
      fileName: "",
      sourceContent: "",
    },
    onSubmit: async ({ value }) => {
      if (!activeKnowledgeBase || !canUpload) return;
      const content = value.sourceContent.trim();
      try {
        if (pendingFile !== undefined) {
          await ingestFileMutation.mutateAsync({
            file: pendingFile,
            knowledgeBaseId: activeKnowledgeBase.id,
            ...(workspaceId === undefined ? {} : { workspaceId }),
          });
          ingestFileMutation.reset();
        } else {
          await createSourceMutation.mutateAsync({
            knowledgeBaseId: activeKnowledgeBase.id,
            ...(workspaceId === undefined ? {} : { workspaceId }),
            fileName: value.fileName,
            mimeType: mimeTypeFor(value.fileName),
            sizeBytes: Math.max(
              1,
              content.length || value.fileName.length * 16,
            ),
            ...(content.length > 0 ? { content } : {}),
          });
          createSourceMutation.reset();
        }
        setNotice(t("knowledgeSourceRegistered"));
        toast(t("knowledgeSourceAdded"), "success");
        setPendingFile(undefined);
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
      if (!activeKnowledgeBase || !reindexing || !canUpload) return;
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
          ...(workspaceId === undefined ? {} : { workspaceId }),
          content,
          sizeBytes: content.length,
        });
        setHits([]);
        setNotice(
          `${t("knowledgeSourceReindexedNotice")}: ${formatNumber(source.chunkCount ?? 0, locale)} ${t("knowledgeChunksLower")}.`,
        );
        reindexSourceMutation.reset();
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
    if (!isSupportedKnowledgeMime(mimeType)) {
      setPendingFile(undefined);
      SourceForm.setFieldValue("fileName", "");
      SourceForm.setFieldValue("sourceContent", "");
      setNotice(t("knowledgeFileWorkerRequired"));
      return;
    }
    SourceForm.setFieldValue("fileName", file.name);
    if (shouldInlineKnowledgeFile(file, mimeType)) {
      setPendingFile(undefined);
      SourceForm.setFieldValue("sourceContent", await file.text());
      setNotice(t("knowledgeFileLoaded"));
      return;
    }
    SourceForm.setFieldValue("sourceContent", "");
    setPendingFile(file);
    setNotice(t("knowledgeFileQueuedForUpload"));
  }

  async function handleQuery(query: string) {
    if (!activeKnowledgeBase || !canUpload) return;
    const results = await queryMutation.mutateAsync({
      knowledgeBaseId: activeKnowledgeBase.id,
      query,
    });
    setHits(results);
    queryMutation.reset();
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
        ...(workspaceId === undefined ? {} : { workspaceId }),
      });
      setHits([]);
      setNotice(t("knowledgeSourceDeletedNotice"));
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
    if (!activeKnowledgeBase || !canUpload) return;
    try {
      const result = await extractSourceMutation.mutateAsync({
        knowledgeBaseId: activeKnowledgeBase.id,
        sourceId,
        ...(workspaceId === undefined ? {} : { workspaceId }),
      });
      setHits([]);
      setNotice(
        `${t("knowledgeExtraction")} ${t(knowledgeJobStatusKey(result.job.status))}: ${formatNumber(result.source.chunkCount ?? 0, locale)} ${t("knowledgeChunksLower")}.`,
      );
      toast(t("knowledgeExtracted"), "success");
    } catch {
      toast(t("knowledgeCouldNotExtractSource"), "error");
    }
  }

  if (activeKnowledgeBase === undefined) {
    return (
      <KnowledgeCatalogBoundary
        ingestReadiness={ingestQuery.data}
        isAdmin={isAdmin}
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
      <KnowledgePanelHeader
        canUpload={canUpload}
        grants={sharesQuery.data ?? []}
        isAdmin={isAdmin}
        knowledgeBase={activeKnowledgeBase}
        onAddSource={() => setSourceDialogOpen(true)}
        onBack={() => onSelectionChange(null)}
        readiness={ingestQuery.data}
      />
      <Section>
        <FormDialog
          onClose={() => {
            setSourceDialogOpen(false);
            setPendingFile(undefined);
          }}
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
              accept={KNOWLEDGE_FILE_ACCEPT}
              className="rm-ui-visually-hidden"
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
              disabled={
                !activeKnowledgeBase ||
                !canUpload ||
                createSourceMutation.isPending ||
                ingestFileMutation.isPending
              }
              type="submit"
            >
              {createSourceMutation.isPending || ingestFileMutation.isPending
                ? t("knowledgeUploading")
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

        <KnowledgeWorkspaceTabs
          activeAgent={activeAgent}
          activeKnowledgeBase={activeKnowledgeBase}
          canUpload={canUpload}
          hits={hits}
          isDeleting={deleteSourceMutation.isPending}
          isExtracting={extractSourceMutation.isPending}
          isQuerying={queryMutation.isPending}
          isReindexing={reindexSourceMutation.isPending}
          notice={notice}
          onAddSource={() => setSourceDialogOpen(true)}
          onDelete={(sourceId) => void handleDeleteSource(sourceId)}
          onExtract={(sourceId) => void handleExtractSource(sourceId)}
          onQuery={handleQuery}
          onReindex={handleReindexSource}
          sourcesQuery={sourcesQuery}
        />
        {dialog}
      </Section>
    </div>
  );
}
