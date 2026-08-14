import { Button } from "@romeo/ui";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";

import type {
  KnowledgeBase,
  KnowledgeIngestReadiness,
} from "../features/knowledge";
import { revokeKnowledgeShare, shareKnowledge } from "../features/access/api";
import type { AccessGrant } from "../features/access/api";
import { useLocale } from "../lib/i18n";
import { Section } from "./console";
import { KnowledgeBaseSummary } from "./KnowledgeBaseSummary";
import { KnowledgeIngestNotice } from "./KnowledgeIngestNotice";
import { ResourceGrantEditor } from "./ResourceGrantEditor";

export function KnowledgePanelHeader(props: {
  canUpload: boolean;
  grants: AccessGrant[];
  isAdmin: boolean;
  knowledgeBase: KnowledgeBase;
  onAddSource: () => void;
  onBack: () => void;
  readiness: KnowledgeIngestReadiness | undefined;
}) {
  const { t } = useLocale();
  return (
    <>
      <Button className="w-fit" onClick={props.onBack} variant="ghost">
        <ArrowLeft aria-hidden="true" size={16} />
        {t("knowledgeBackToBases")}
      </Button>
      <KnowledgeBaseSummary
        canUpload={props.canUpload}
        knowledgeBase={props.knowledgeBase}
        onAddSource={props.onAddSource}
      />
      <KnowledgeIngestNotice
        isAdmin={props.isAdmin}
        readiness={props.readiness}
      />
      {props.isAdmin ? (
        <Section
          description={t("knowledgeAccessHelp")}
          title={t("knowledgeAccess")}
        >
          <ResourceGrantEditor
            grants={props.grants}
            onGrant={(share) => shareKnowledge(props.knowledgeBase.id, share)}
            onRevoke={(grantId) =>
              revokeKnowledgeShare(props.knowledgeBase.id, grantId)
            }
            permissionOptions={["read", "use", "write"]}
            queryKey={["knowledgeShares", props.knowledgeBase.id]}
          />
        </Section>
      ) : null}
    </>
  );
}
