import {
  Profiler,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import {
  transcriptMessageDomId,
  TranscriptWindow,
} from "../src/components/TranscriptWindow";
import { useTranscriptRowVisibility } from "../src/components/transcript-row-visibility";
import {
  captureTranscriptPrependAnchor,
  restoreTranscriptPrependAnchor,
  type TranscriptPrependAnchor,
} from "../src/lib/transcript-prepend-anchor";

import "../src/styles/app.css";
import "./transcript-virtualization.css";

interface BenchmarkMessage {
  id: string;
  kind: "artifact" | "code" | "prose" | "table";
  paragraphs: number;
}

interface BenchmarkMetrics {
  commitCount: number;
  commitDurationMs: number;
  longTasks: number[];
  maxMountedRows: number;
  prependSnapshot?: TranscriptPrependAnchor;
  prependSettled?: { messageOffset: number | null; scrollTop: number };
  maxActiveHeavyRows: number;
  activeHeavyRows: number;
  heavyWorkStarts: number;
  heavyWorkSuspensions: number;
  renderedRows: number;
  supportsLongTasks: boolean;
  virtualized: boolean;
}

declare global {
  interface Window {
    transcriptBenchmark: {
      metrics: BenchmarkMetrics;
      prepend: () => void;
    };
  }
}

const metrics: BenchmarkMetrics = {
  commitCount: 0,
  commitDurationMs: 0,
  longTasks: [],
  maxMountedRows: 0,
  maxActiveHeavyRows: 0,
  activeHeavyRows: 0,
  heavyWorkStarts: 0,
  heavyWorkSuspensions: 0,
  renderedRows: 0,
  supportsLongTasks:
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("longtask"),
  virtualized: false,
};
let prepend: () => void = () => {};
window.transcriptBenchmark = { metrics, prepend: () => prepend() };

if (metrics.supportsLongTasks) {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      metrics.longTasks.push(entry.duration);
  }).observe({ entryTypes: ["longtask"] });
}

const initialMessages = createMessages(1_200, 0);

function Benchmark() {
  const [messages, setMessages] = useState(initialMessages);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pendingPrepend = useRef<TranscriptPrependAnchor | undefined>(undefined);
  const getScrollElement = useCallback(() => viewportRef.current, []);
  prepend = () => {
    const viewport = viewportRef.current;
    pendingPrepend.current = captureTranscriptPrependAnchor(viewport);
    metrics.prependSnapshot = pendingPrepend.current;
    setMessages((current) => [...createMessages(100, -100), ...current]);
  };
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const snapshot = pendingPrepend.current;
    if (viewport === null || snapshot === undefined) return;
    return restoreTranscriptPrependAnchor(viewport, snapshot, () => {
      const anchor = [
        ...viewport.querySelectorAll<HTMLElement>("[data-message-id]"),
      ].find((element) => element.dataset.messageId === snapshot.messageId);
      metrics.prependSettled = {
        messageOffset:
          anchor === undefined
            ? null
            : anchor.getBoundingClientRect().top -
              viewport.getBoundingClientRect().top,
        scrollTop: viewport.scrollTop,
      };
      pendingPrepend.current = undefined;
    });
  }, [messages]);
  return (
    <main>
      <h1>Variable-height transcript</h1>
      <div className="benchmark-viewport" ref={viewportRef}>
        <Profiler
          id="transcript"
          onRender={(_id, _phase, duration) => {
            metrics.commitCount++;
            metrics.commitDurationMs += duration;
          }}
        >
          <TranscriptWindow
            accessibleDescription="All loaded messages are rendered"
            estimateSize={(index) => estimateHeight(messages[index])}
            feedLabel="Conversation transcript"
            getScrollElement={getScrollElement}
            items={messages}
            onVirtualizationChange={(enabled) => {
              metrics.virtualized = enabled;
              requestAnimationFrame(recordMountedRows);
            }}
            renderItem={(message, index) => {
              metrics.renderedRows++;
              queueMicrotask(recordMountedRows);
              return (
                <article
                  aria-labelledby={`${transcriptMessageDomId(message.id)}-heading`}
                  aria-posinset={index + 1}
                  aria-setsize={messages.length}
                  className="benchmark-message"
                  data-message-id={message.id}
                  id={transcriptMessageDomId(message.id)}
                  key={message.id}
                  tabIndex={-1}
                >
                  <h2 id={`${transcriptMessageDomId(message.id)}-heading`}>
                    Message {message.id}
                  </h2>
                  <HeavyWorkProbe />
                  {Array.from(
                    { length: message.paragraphs },
                    (_, paragraph) => (
                      <p key={paragraph}>
                        Variable height prose for dynamic row measurement and
                        stable scroll anchoring.
                      </p>
                    ),
                  )}
                  {message.kind === "code" ? (
                    <pre>
                      <code>
                        {`const row_${index} = ${index};\n`.repeat(8)}
                      </code>
                    </pre>
                  ) : null}
                  {message.kind === "table" ? (
                    <table>
                      <tbody>
                        {Array.from({ length: 5 }, (_, row) => (
                          <tr key={row}>
                            <th>Field {row}</th>
                            <td>Value {index + row}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  {message.kind === "artifact" ? (
                    <div className="benchmark-artifact">Artifact preview</div>
                  ) : null}
                </article>
              );
            }}
            showAllLabel="Show all"
            useWindowedLabel="Use window"
            windowedDescription="Nearby messages are rendered"
          />
        </Profiler>
      </div>
    </main>
  );
}

function HeavyWorkProbe() {
  const visible = useTranscriptRowVisibility();
  useLayoutEffect(() => {
    if (!visible) return;
    metrics.activeHeavyRows++;
    metrics.heavyWorkStarts++;
    metrics.maxActiveHeavyRows = Math.max(
      metrics.maxActiveHeavyRows,
      metrics.activeHeavyRows,
    );
    return () => {
      metrics.activeHeavyRows--;
      metrics.heavyWorkSuspensions++;
    };
  }, [visible]);
  return (
    <span data-heavy-active={visible ? "true" : "false"} hidden>
      Simulated media and diagram work
    </span>
  );
}

function createMessages(count: number, start: number): BenchmarkMessage[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    return {
      id: `benchmark_${index}`,
      kind:
        offset % 13 === 0
          ? "artifact"
          : offset % 11 === 0
            ? "table"
            : offset % 7 === 0
              ? "code"
              : "prose",
      paragraphs: 1 + (Math.abs(index) % 6),
    };
  });
}

function estimateHeight(message: BenchmarkMessage | undefined): number {
  if (message === undefined) return 180;
  const extra =
    message.kind === "code"
      ? 180
      : message.kind === "table"
        ? 210
        : message.kind === "artifact"
          ? 150
          : 0;
  return 80 + message.paragraphs * 42 + extra;
}

function recordMountedRows() {
  const count = document.querySelectorAll(".rm-message-window-row").length;
  metrics.maxMountedRows = Math.max(metrics.maxMountedRows, count);
}

createRoot(document.getElementById("root")!).render(<Benchmark />);
