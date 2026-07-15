import Check from "lucide-react/dist/esm/icons/check.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import type { ReactNode } from "react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    // @ts-expect-error react element children
    return extractText(node.props?.children);
  }
  return "";
}

function CodeCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="rm-codeblock-copy"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      type="button"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Markdown rendering via react-markdown + remark-gfm (tables, task lists,
 * strikethrough, autolinks) + rehype-highlight (highlight.js). Fenced code
 * blocks get an Open WebUI-style header bar with a language label + copy button.
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="rm-markdown">
      <ReactMarkdown
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} rel="noreferrer nofollow" target="_blank" />
          ),
          pre: ({ children }) => {
            const codeEl = Array.isArray(children) ? children[0] : children;
            const className: string =
              (codeEl &&
                typeof codeEl === "object" &&
                "props" in codeEl &&
                (codeEl.props as { className?: string })?.className) ||
              "";
            const lang = /language-(\w+)/.exec(className)?.[1] ?? "text";
            const raw = extractText(children);
            return (
              <div className="rm-codeblock">
                <div className="rm-codeblock-head">
                  <span>{lang}</span>
                  <CodeCopyButton text={raw} />
                </div>
                <pre>{children}</pre>
              </div>
            );
          },
        }}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
