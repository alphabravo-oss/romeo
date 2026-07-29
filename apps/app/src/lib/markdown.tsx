import { Button } from "@romeo/ui";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import Eye from "lucide-react/dist/esm/icons/eye.mjs";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.mjs";
import type { ComponentProps, ReactNode } from "react";
import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { writeTextToClipboard } from "./clipboard";
import { useLocale } from "./i18n";
import { downloadText } from "./download";
import { toast } from "./toast";

type RehypePlugins = NonNullable<
  ComponentProps<typeof ReactMarkdown>["rehypePlugins"]
>;
type RemarkPlugins = NonNullable<
  ComponentProps<typeof ReactMarkdown>["remarkPlugins"]
>;
const fencedCodePattern = /(^|\n)\s*(?:```|~~~)/u;
const mathPattern = /(^|[^\\])(?:\$\$|\\\(|\\\[)/u;

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

function useStreamingContent(content: string, streaming: boolean): string {
  const [rendered, setRendered] = useState(content);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!streaming) {
      if (frameRef.current !== undefined)
        cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
      setRendered(content);
      return;
    }
    if (frameRef.current !== undefined) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      setRendered(content);
    });
    return () => {
      if (frameRef.current !== undefined)
        cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    };
  }, [content, streaming]);

  return rendered;
}

function CodeBlock({
  code,
  highlighted,
  language,
}: {
  code: string;
  highlighted: ReactNode;
  language: string;
}) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const canPreview = language === "mermaid";

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
    <div className="rm-codeblock">
      <div className="rm-codeblock-head">
        <Button
          aria-label={collapsed ? t("expandCode") : t("collapseCode")}
          className="rm-codeblock-label"
          onClick={() => setCollapsed((value) => !value)}
          type="button"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <span>{language}</span>
        </Button>
        <div className="rm-codeblock-actions">
          {canPreview ? (
            <Button onClick={() => setPreview((value) => !value)} type="button">
              {preview ? <EyeOff size={13} /> : <Eye size={13} />}
              {preview ? t("hidePreview") : t("preview")}
            </Button>
          ) : null}
          <Button onClick={downloadCode} type="button">
            <Download size={13} /> {t("download")}
          </Button>
          <Button onClick={() => void copyCode()} type="button">
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t("copied") : t("copy")}
          </Button>
        </div>
      </div>
      {collapsed ? null : <pre>{highlighted}</pre>}
      {preview && language === "mermaid" ? (
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
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const renderedContent = useStreamingContent(content, streaming);
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
    <div className="rm-markdown">
      <ReactMarkdown
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} rel="noreferrer nofollow" target="_blank" />
          ),
          pre: ({ children }) => {
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
