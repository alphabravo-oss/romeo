import { Button } from "@romeo/ui";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import Eye from "lucide-react/dist/esm/icons/eye.mjs";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.mjs";
import PanelRight from "lucide-react/dist/esm/icons/panel-right.mjs";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { writeTextToClipboard } from "./clipboard";
import { citationHrefPrefix, renderableContent } from "./chat-citations";
import { useLocale } from "./i18n";
import { downloadText } from "./download";
import type { ChatCitation } from "./run-registry";
import { toast } from "./toast";

type RehypePlugins = NonNullable<
  ComponentProps<typeof ReactMarkdown>["rehypePlugins"]
>;
type RemarkPlugins = NonNullable<
  ComponentProps<typeof ReactMarkdown>["remarkPlugins"]
>;
const fencedCodePattern = /(^|\n)\s*(?:```|~~~)/u;
const mathPattern = /(^|[^\\])(?:\$\$|\\\(|\\\[)/u;

/**
 * How a fenced block reaches the canvas pane. Supplied by ChatPanel and read
 * from context rather than passed down, because the alternative is a prop on
 * Markdown that every transcript row would have to forward on every token.
 *
 * Left undefined everywhere else -- including inside the pane itself, where the
 * block on screen IS the artifact -- so the default rendering is unchanged and
 * the pane cannot recurse into itself.
 */
export interface ArtifactBinding {
  lookup: (
    messageId: string,
    offset: number,
  ) => { key: string; total: number; version: number } | undefined;
  open: (key: string, version: number) => void;
  /** The revision on screen, so only that one block yields to the pane. */
  shownKey: string | undefined;
  shownVersion: number | undefined;
}

export const ArtifactContext = createContext<ArtifactBinding | undefined>(
  undefined,
);

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText(
      (node.props as { children?: ReactNode } | undefined)?.children,
    );
  }
  return "";
}

function CodeBlock({
  code,
  highlighted,
  language,
  messageId,
  offset,
  previewDiagrams,
}: {
  code: string;
  highlighted: ReactNode;
  language: string;
  messageId: string | undefined;
  /** Character offset of the fence, which is what makes this block addressable. */
  offset: number | undefined;
  previewDiagrams: boolean;
}) {
  const { t } = useLocale();
  const artifacts = useContext(ArtifactContext);
  const canPreview = language === "mermaid";
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(canPreview && previewDiagrams);
  const placement =
    messageId === undefined || offset === undefined
      ? undefined
      : artifacts?.lookup(messageId, offset);
  // Promotion, not removal: only the one revision the pane is showing steps
  // aside, and it comes straight back when the pane closes.
  const promoted =
    placement !== undefined &&
    placement.key === artifacts?.shownKey &&
    placement.version === artifacts.shownVersion;

  async function copyCode() {
    if (!(await writeTextToClipboard(code))) {
      toast(t("copyFailed"), "error");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  function downloadCode() {
    const extension = languageExtension(language);
    downloadText(code, `romeo-code.${extension}`);
  }

  return (
    <div className={promoted ? "rm-codeblock promoted" : "rm-codeblock"}>
      <div className="rm-codeblock-head">
        {promoted ? (
          // No dead control: while the block is in the pane there is nothing
          // left here to collapse.
          <span className="rm-codeblock-label">
            <span>{language}</span>
          </span>
        ) : (
          <Button
            aria-label={collapsed ? t("expandCode") : t("collapseCode")}
            className="rm-codeblock-label"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? t("expandCode") : t("collapseCode")}
            type="button"
          >
            <span>{language}</span>
          </Button>
        )}
        <div className="rm-codeblock-actions">
          {placement === undefined || artifacts === undefined ? null : (
            <Button
              aria-label={promoted ? t("artifactInCanvas") : t("openInCanvas")}
              onClick={() => artifacts.open(placement.key, placement.version)}
              title={
                placement.total > 1
                  ? `${promoted ? t("artifactInCanvas") : t("openInCanvas")} · ${t("artifactVersion", {
                      total: placement.total,
                      version: placement.version + 1,
                    })}`
                  : promoted
                    ? t("artifactInCanvas")
                    : t("openInCanvas")
              }
              type="button"
            >
              <PanelRight size={14} />
            </Button>
          )}
          {canPreview && !promoted ? (
            <Button
              aria-label={preview ? t("hidePreview") : t("preview")}
              onClick={() => setPreview((value) => !value)}
              title={preview ? t("hidePreview") : t("preview")}
              type="button"
            >
              {preview ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
          ) : null}
          <Button
            aria-label={t("download")}
            onClick={downloadCode}
            title={t("download")}
            type="button"
          >
            <Download size={14} />
          </Button>
          <Button
            aria-label={copied ? t("copied") : t("copy")}
            onClick={() => void copyCode()}
            title={copied ? t("copied") : t("copy")}
            type="button"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        </div>
      </div>
      {collapsed || promoted ? null : <pre>{highlighted}</pre>}
      {preview && canPreview && !promoted ? (
        <MermaidPreview code={code} />
      ) : null}
    </div>
  );
}

function MermaidPreview({ code }: { code: string }) {
  const { t } = useLocale();
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        const result = await mermaid.render(
          `rm-mermaid-${crypto.randomUUID()}`,
          code,
        );
        if (active) setSvg(result.svg);
      })
      .catch(() => {
        if (active) setError(t("diagramError"));
      });
    return () => {
      active = false;
    };
  }, [code, t]);

  if (error) return <div className="rm-code-preview-error">{error}</div>;
  if (!svg)
    return <div className="rm-code-preview-loading">{t("diagramLoading")}</div>;
  return (
    <div
      className="rm-mermaid-preview"
      // Mermaid strict mode sanitizes generated SVG and disables HTML labels.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Safe rich response renderer. Raw model HTML remains text; explicit HTML
 * fences remain inert text. Mermaid diagrams use the strict renderer only.
 */
export const Markdown = memo(function Markdown({
  citations = noCitations,
  content,
  messageId,
  previewDiagrams = false,
  streaming = false,
}: {
  /** Stable identity required: this component is memoised. */
  citations?: ChatCitation[];
  content: string;
  /** Half of a fenced block's canvas identity; omitted, nothing is promotable. */
  messageId?: string;
  previewDiagrams?: boolean;
  streaming?: boolean;
}) {
  // ChatGPT-like: paint every byte already in the cache. No typewriter lag —
  // provider token cadence is the only source of "chunks".
  const renderedContent = renderableContent(content, citations.length);
  const usesFencedCode = fencedCodePattern.test(renderedContent);
  const usesMath = mathPattern.test(renderedContent);
  const [rehypePlugins, setRehypePlugins] = useState<RehypePlugins>([]);
  const [remarkPlugins, setRemarkPlugins] = useState<RemarkPlugins>([
    remarkGfm,
  ]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      usesFencedCode
        ? import("rehype-highlight").then((module) => module.default)
        : Promise.resolve(undefined),
      usesMath
        ? import("rehype-katex").then((module) => module.default)
        : Promise.resolve(undefined),
      usesMath
        ? import("remark-math").then((module) => module.default)
        : Promise.resolve(undefined),
      usesMath
        ? import("katex/dist/katex.min.css")
        : Promise.resolve(undefined),
    ]).then(([highlight, katex, math]) => {
      if (!active) return;
      setRehypePlugins([
        ...(highlight === undefined
          ? []
          : [
              [
                highlight,
                { detect: true, ignoreMissing: true },
              ] as RehypePlugins[number],
            ]),
        ...(katex === undefined ? [] : [katex]),
      ]);
      setRemarkPlugins([remarkGfm, ...(math === undefined ? [] : [math])]);
    });
    return () => {
      active = false;
    };
  }, [usesFencedCode, usesMath]);

  return (
    // The streaming class alone drives the caret at the token frontier: it is a
    // ::after on the last block, so it costs no element, no prop and no render.
    <div className={streaming ? "rm-markdown streaming" : "rm-markdown"}>
      <ReactMarkdown
        components={{
          a: ({ children, node: _node, ...props }) => {
            const citation = citationForHref(props.href, citations);
            if (citation !== undefined) {
              return (
                <CitationMarker citation={citation}>{children}</CitationMarker>
              );
            }
            return (
              <a {...props} rel="noreferrer nofollow" target="_blank">
                {children}
              </a>
            );
          },
          pre: ({ children, node }) => {
            const codeElement = Array.isArray(children)
              ? children[0]
              : children;
            const className =
              codeElement &&
              typeof codeElement === "object" &&
              "props" in codeElement
                ? ((codeElement.props as { className?: string }).className ??
                  "")
                : "";
            const language =
              /(?:^|\s)language-([^\s]+)/u
                .exec(className)?.[1]
                ?.toLowerCase() ?? "text";
            return (
              <CodeBlock
                code={extractText(children).replace(/\n$/u, "")}
                highlighted={children}
                language={language}
                messageId={messageId}
                offset={node?.position?.start.offset}
                previewDiagrams={previewDiagrams}
              />
            );
          },
        }}
        rehypePlugins={rehypePlugins}
        remarkPlugins={remarkPlugins}
      >
        {renderedContent}
      </ReactMarkdown>
    </div>
  );
});

const noCitations: ChatCitation[] = [];

function citationForHref(
  href: string | undefined,
  citations: ChatCitation[],
): ChatCitation | undefined {
  if (href === undefined || !href.startsWith(citationHrefPrefix)) {
    return undefined;
  }
  return citations[Number(href.slice(citationHrefPrefix.length))];
}

/**
 * The source, at the point the answer used it. The card is revealed by CSS
 * alone -- :hover for a pointer, :focus-within for a keyboard -- because a
 * scripted popover here fights itself: every popover library moves focus into
 * the panel when it opens, so opening on focus and closing on blur loops, and
 * the alternative (open on click only) is exactly the affordance a reader
 * skimming an answer will not use.
 *
 * The card is a preview, not a destination: it holds no link, which is what
 * lets it vanish the instant the pointer leaves. The reachable copy of every
 * source is the CitationList below the answer, kept mounted for that reason.
 *
 * The marker is a plain anchor, and a bare <span> when the citation has no URI
 * to go to. It was a Button, which announced itself as a control and then did
 * nothing on Enter -- there was never a handler to write, because opening the
 * source is exactly what an <a> already does. The anchor is also what makes
 * :focus-within above real: a keyboard reaches the card by tabbing to a link
 * that goes somewhere, so nothing has to fake a tab stop. A citation with only
 * a chunkId has no destination, so it gets no tab stop and no announced role;
 * its title still reads out from the CitationList.
 */
function CitationMarker({
  children,
  citation,
}: {
  children: ReactNode;
  citation: ChatCitation;
}) {
  const { t } = useLocale();
  return (
    <sup className="rm-citation-sup">
      {citation.sourceUri === undefined ? (
        <span className="rm-citation-marker">{children}</span>
      ) : (
        <a
          aria-label={t("citationMarkerLabel", { title: citation.title })}
          className="rm-citation-marker"
          href={citation.sourceUri}
          rel="noreferrer nofollow"
          target="_blank"
        >
          {children}
        </a>
      )}
      <span aria-hidden="true" className="rm-citation-card">
        <strong>{citation.title}</strong>
        <span>
          {citation.sourceUri ?? citation.chunkId}
          {citation.provider === undefined ? "" : ` · ${citation.provider}`}
        </span>
      </span>
    </sup>
  );
}

function languageExtension(language: string): string {
  const aliases: Record<string, string> = {
    bash: "sh",
    javascript: "js",
    jsx: "jsx",
    plaintext: "txt",
    python: "py",
    typescript: "ts",
    tsx: "tsx",
  };
  return aliases[language] ?? (language.replace(/[^a-z0-9]+/gu, "") || "txt");
}
