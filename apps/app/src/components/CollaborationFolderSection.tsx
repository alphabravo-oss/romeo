import { Button } from "@romeo/ui";
import type { UseQueryResult } from "@tanstack/react-query";

import type { WorkspaceFolder, WorkspaceFolderItem } from "../features";
import type { Agent } from "../features/types";
import { useLocale, type MessageKey } from "../lib/i18n";
import { AddButton } from "./AddButton";
import { Section } from "./console";
import { PanelState } from "../lib/panel-state";
import { ResourceRow } from "./ResourceRow";

export function CollaborationFolderSection(props: {
  activeAgent: Agent | undefined;
  activeFolder: WorkspaceFolder | undefined;
  addPending: boolean;
  canShare: boolean;
  catalogs: {
    chats: Array<{ id: string; title: string }>;
    gallery: Array<{ id: string; name: string }>;
    knowledgeBases: Array<{ id: string; name: string }>;
  };
  chatId: string | undefined;
  folderItems: WorkspaceFolderItem[];
  foldersQuery: UseQueryResult<WorkspaceFolder[], unknown>;
  onAddItem: (
    resourceType: "agent" | "chat" | "knowledge_base",
    resourceId: string | undefined,
  ) => void;
  onCreate: () => void;
  onSelect: (folderId: string) => void;
  onShare: () => void;
  selectedKnowledgeBaseId: string | undefined;
  sharePending: boolean;
}) {
  const { t } = useLocale();
  return (
    <Section
      actions={
        <AddButton onClick={props.onCreate}>
          {t("workspaceNewFolder")}
        </AddButton>
      }
      description={t("workspaceFoldersHelp")}
      title={t("workspaceFolders")}
    >
      <PanelState
        empty={t("workspaceNoFolders")}
        emptyAction={
          <Button onClick={props.onCreate} type="button" variant="primary">
            {t("workspaceNewFolder")}
          </Button>
        }
        query={props.foldersQuery}
      >
        {(folders) => (
          <div className="rm-resource-list">
            {folders.map((folder) => (
              <ResourceRow
                actions={
                  folder.id === props.activeFolder?.id ? (
                    <Button
                      data-testid="folder-share"
                      disabled={!props.canShare || props.sharePending}
                      onClick={props.onShare}
                      size="sm"
                      type="button"
                    >
                      {t("workspaceShare")}
                    </Button>
                  ) : null
                }
                key={folder.id}
                meta={
                  folder.id === props.activeFolder?.id
                    ? t("workspaceFolderSelected")
                    : t("workspaceFolderOpen")
                }
                onSelect={() => props.onSelect(folder.id)}
                selected={folder.id === props.activeFolder?.id}
                title={folder.name}
              />
            ))}
          </div>
        )}
      </PanelState>
      {props.activeFolder ? (
        <div className="grid gap-3" data-testid="folder-controls">
          <div className="rm-resource-row__actions rm-resource-row__actions--start">
            <Button
              data-testid="folder-add-chat"
              disabled={props.chatId === undefined || props.addPending}
              onClick={() => props.onAddItem("chat", props.chatId)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("workspaceAddChat")}
            </Button>
            <Button
              data-testid="folder-add-agent"
              disabled={!props.activeAgent || props.addPending}
              onClick={() => props.onAddItem("agent", props.activeAgent?.id)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("workspaceAddAgent")}
            </Button>
            <Button
              data-testid="folder-add-kb"
              disabled={
                props.selectedKnowledgeBaseId === undefined || props.addPending
              }
              onClick={() =>
                props.onAddItem("knowledge_base", props.selectedKnowledgeBaseId)
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("workspaceAddKnowledge")}
            </Button>
          </div>
          {props.folderItems.length === 0 ? (
            <p className="rm-list-empty">{t("workspaceFolderEmpty")}</p>
          ) : (
            <div className="rm-resource-list">
              {props.folderItems.map((item) => (
                <ResourceRow
                  key={item.id}
                  meta={resolveFolderItemName(item, props.catalogs)}
                  title={t(resourceTypeMessageKey(item.resourceType))}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Section>
  );
}

function resolveFolderItemName(
  item: Pick<WorkspaceFolderItem, "resourceId" | "resourceType">,
  catalogs: CollaborationFolderSectionProps["catalogs"],
): string {
  if (item.resourceType === "agent")
    return (
      catalogs.gallery.find((entry) => entry.id === item.resourceId)?.name ??
      item.resourceId
    );
  if (item.resourceType === "chat")
    return (
      catalogs.chats.find((entry) => entry.id === item.resourceId)?.title ??
      item.resourceId
    );
  return (
    catalogs.knowledgeBases.find((entry) => entry.id === item.resourceId)
      ?.name ?? item.resourceId
  );
}

type CollaborationFolderSectionProps = Parameters<
  typeof CollaborationFolderSection
>[0];

function resourceTypeMessageKey(
  resourceType: WorkspaceFolderItem["resourceType"],
): MessageKey {
  if (resourceType === "agent") return "workspaceResourceAgent";
  if (resourceType === "chat") return "workspaceResourceChat";
  return "workspaceResourceKnowledge";
}
