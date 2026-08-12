import { Button } from "@romeo/ui";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import FileCode from "lucide-react/dist/esm/icons/file-code.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";

import { useLocale } from "../lib/i18n";
import { ArtifactContext, Markdown } from "../lib/markdown";
import { artifactMarkdown, type ChatArtifact } from "./chat-artifacts";

/**
 * A plain <aside> beside the transcript, not a dialog: the stream keeps running
 * while this is open, and a modal would trap focus away from the answer that is
 * still being written. It is dismissed by its own close button rather than
 * Escape, because Escape already belongs to the composer's menus and the pane
 * holds no focus to give back.
 *
 * ponytail: not user-resizable. Upgrade path: parameterise useSidebarResize's
 * min/max/storage-key constants and mirror .rm-sidebar-resizer on the left edge.
 */
export function ArtifactPane({
  artifact,
  onClose,
  onSelectVersion,
  version,
}: {
  artifact: ChatArtifact;
  onClose: () => void;
  onSelectVersion: (version: number) => void;
  version: number;
}) {
  const { t } = useLocale();
  const total = artifact.versions.length;
  const shown = artifact.versions[version];
  return (
    <aside aria-label={t("artifactPane")} className="rm-artifact-pane">
      <header className="rm-artifact-head">
        <div className="rm-artifact-title">
          <FileCode aria-hidden="true" size={15} />
          <strong>{artifact.title}</strong>
        </div>
        {/* Nothing to page through until the model has rewritten this once, and
            two permanently disabled arrows say less than no arrows at all. */}
        {total > 1 ? (
          <div className="rm-artifact-versions">
            <Button
              aria-label={t("previousArtifactVersion")}
              disabled={version <= 0}
              onClick={() => onSelectVersion(version - 1)}
              size="icon"
              variant="ghost"
            >
              <ChevronLeft aria-hidden="true" size={14} />
            </Button>
            {/* The only live region here: the code below re-announcing itself on
                every revision would bury the rest of the page. */}
            <span aria-live="polite" className="rm-artifact-version">
              {t("artifactVersion", { total, version: version + 1 })}
            </span>
            <Button
              aria-label={t("nextArtifactVersion")}
              disabled={version >= total - 1}
              onClick={() => onSelectVersion(version + 1)}
              size="icon"
              variant="ghost"
            >
              <ChevronRight aria-hidden="true" size={14} />
            </Button>
          </div>
        ) : null}
        <Button
          aria-label={t("closeArtifact")}
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden="true" size={16} />
        </Button>
      </header>
      <div className="rm-artifact-body">
        {shown === undefined ? null : (
          // Back through the transcript's own renderer, so highlighting,
          // mermaid, copy and download are the same code here as there.
          <ArtifactContext.Provider value={undefined}>
            {/* Keyed by artifact, not by version: paging through revisions must
                keep whatever the reader set (collapsed, diagram shown), while
                opening a different artifact starts from its own defaults. */}
            <Markdown
              content={artifactMarkdown(shown)}
              key={artifact.key}
              previewDiagrams
            />
          </ArtifactContext.Provider>
        )}
      </div>
    </aside>
  );
}
