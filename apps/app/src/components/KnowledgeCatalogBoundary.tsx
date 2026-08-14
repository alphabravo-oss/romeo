import type {
  KnowledgeBase,
  KnowledgeIngestReadiness,
} from "../features/knowledge";
import { KnowledgeCatalogPage } from "./KnowledgeCatalogPage";

export function KnowledgeCatalogBoundary(props: {
  ingestReadiness: KnowledgeIngestReadiness | undefined;
  isAdmin: boolean;
  isLoading: boolean;
  knowledgeBases: KnowledgeBase[];
  onCreated: (knowledgeBaseId: string) => void;
  onSelectionChange: (knowledgeBaseId: string | null) => void;
  workspaceId: string | undefined;
}) {
  return (
    <KnowledgeCatalogPage
      {...(props.ingestReadiness === undefined
        ? {}
        : { ingestReadiness: props.ingestReadiness })}
      isAdmin={props.isAdmin}
      isLoading={props.isLoading}
      knowledgeBases={props.knowledgeBases}
      onCreated={props.onCreated}
      onSelectionChange={props.onSelectionChange}
      workspaceId={props.workspaceId}
    />
  );
}
