import type {
  KnowledgeBase,
  KnowledgeIngestReadiness,
} from "../features/knowledge";
import { KnowledgeCatalogPage } from "./KnowledgeCatalogPage";
import type { ServerTableState } from "./DataTable";

export function KnowledgeCatalogBoundary(props: {
  ingestReadiness: KnowledgeIngestReadiness | undefined;
  isAdmin: boolean;
  knowledgeBases: KnowledgeBase[];
  onCreated: (knowledgeBaseId: string) => void;
  onSelectionChange: (knowledgeBaseId: string | null) => void;
  workspaceId: string | undefined;
  tableState: ServerTableState;
}) {
  return (
    <KnowledgeCatalogPage
      {...(props.ingestReadiness === undefined
        ? {}
        : { ingestReadiness: props.ingestReadiness })}
      isAdmin={props.isAdmin}
      knowledgeBases={props.knowledgeBases}
      onCreated={props.onCreated}
      onSelectionChange={props.onSelectionChange}
      workspaceId={props.workspaceId}
      tableState={props.tableState}
    />
  );
}
