import { createServer, request as httpRequest } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip, constants as zlibConstants } from "node:zlib";

import { chromium, firefox, webkit } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = resolve(root, "dist/ci/run-sse-browser-acceptance.json");
const configuredEngines = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];
const requestedEngines = new Set(
  (process.env.ROMEO_BROWSER_ENGINES ?? "chromium,firefox,webkit")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const engines = configuredEngines.filter(([name]) =>
  requestedEngines.has(name),
);
assert(engines.length > 0, "No supported browser engines were selected");

const observedResumeCursors = new Map();
const origin = createServer((request, response) => {
  void serveOrigin(request, response);
});
await listen(origin);
const originPort = addressPort(origin);
const proxy = createServer((request, response) => {
  if (request.url === "/" || request.url === undefined) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Romeo SSE acceptance</title>");
    return;
  }
  void proxySse(request, response, originPort, observedResumeCursors);
});
await listen(proxy);
const proxyUrl = `http://127.0.0.1:${addressPort(proxy)}`;

const results = [];
try {
  for (const [name, browserType] of engines) {
    const result = { engine: name, status: "failed", modes: [] };
    let browser;
    try {
      browser = await browserType.launch({ headless: true });
      result.version = browser.version();
      const page = await browser.newPage();
      await page.goto(proxyUrl, { waitUntil: "domcontentloaded" });

      for (const mode of ["passthrough", "gzip", "buffered", "idle"]) {
        const measurement = await runBrowserAcceptance(page, mode, name);
        assert(
          measurement.sequences.join(",") === "1,2",
          `${name}/${mode} returned an invalid sequence`,
        );
        assert(
          measurement.heartbeatCount > 0,
          `${name}/${mode} lost heartbeat`,
        );
        assert(
          measurement.contentType.startsWith("text/event-stream"),
          `${name}/${mode} lost SSE content type`,
        );
        if (mode === "buffered")
          assert(
            measurement.firstFrameMs >= 100,
            `${name}/buffered did not exercise buffering`,
          );
        result.modes.push({
          mode,
          attemptCount: measurement.attemptCount,
          eventCount: measurement.sequences.length,
          heartbeatCount: measurement.heartbeatCount,
          firstFrameMs: measurement.firstFrameMs,
        });
      }
      const cursors = observedResumeCursors.get(name) ?? [];
      assert(
        cursors.join(",") === "0,1",
        `${name}/idle did not resume from Last-Event-ID`,
      );
      result.status = "passed";
      await page.close();
    } catch (error) {
      result.failure = sanitizeFailure(error);
    } finally {
      await browser?.close();
      results.push(result);
    }
  }
} finally {
  await Promise.all([close(origin), close(proxy)]);
}

const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  status: results.every((result) => result.status === "passed")
    ? "passed"
    : "failed",
  controls: {
    fetchReadableStream: true,
    chunkBoundarySplitting: true,
    heartbeatComments: true,
    gzipProxy: true,
    bufferingProxy: true,
    idleDisconnectResumeCursor: true,
  },
  redaction: {
    eventDataReturned: false,
    requestHeadersReturned: false,
    endpointReturned: false,
  },
  results,
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

const failures = results.filter((result) => result.status !== "passed");
if (failures.length > 0)
  throw new Error(
    `Run SSE browser acceptance failed: ${failures
      .map((result) => `${result.engine}: ${result.failure}`)
      .join("; ")}`,
  );
console.log(
  `Run SSE fetch/proxy acceptance passed for ${results.map((result) => `${result.engine} ${result.version}`).join(", ")}.`,
);
console.log(`Wrote metadata-only evidence to ${evidencePath}`);

async function serveOrigin(request, response) {
  const url = new URL(request.url ?? "/", "http://origin.invalid");
  const mode = url.searchParams.get("mode") ?? "passthrough";
  const cursor = Number(request.headers["last-event-id"] ?? "0");
  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "close",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  await writeSplit(response, ": heartbeat\n\n");
  if (mode === "idle" && cursor === 0) {
    await writeSplit(response, eventFrame(1, false));
    // The proxy below closes this otherwise-healthy upstream connection first,
    // emulating an intermediary idle timeout between sparse model events.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    if (response.destroyed) return;
    await writeSplit(response, eventFrame(2, true));
    response.end();
    return;
  }
  const firstSequence = cursor >= 1 ? 2 : 1;
  for (let sequence = firstSequence; sequence <= 2; sequence += 1) {
    await writeSplit(response, eventFrame(sequence, sequence === 2));
    if (sequence < 2) await writeSplit(response, ": heartbeat\n\n");
  }
  response.end();
}

async function proxySse(request, response, originPort, observedCursors) {
  const url = new URL(request.url ?? "/", "http://proxy.invalid");
  const mode = url.searchParams.get("mode") ?? "passthrough";
  const engine = url.searchParams.get("engine") ?? "unknown";
  const lastEventId = request.headers["last-event-id"] ?? "0";
  if (mode === "idle") {
    const cursors = observedCursors.get(engine) ?? [];
    cursors.push(Number(lastEventId));
    observedCursors.set(engine, cursors);
  }
  const upstream = httpRequest(
    {
      host: "127.0.0.1",
      port: originPort,
      path: request.url,
      headers: {
        accept: "text/event-stream",
        "last-event-id": lastEventId,
      },
    },
    (upstreamResponse) => {
      const headers = {
        "cache-control": "no-cache, no-transform",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      };
      if (mode === "gzip") {
        response.writeHead(200, { ...headers, "content-encoding": "gzip" });
        const gzip = createGzip({ flush: zlibConstants.Z_SYNC_FLUSH });
        upstreamResponse.pipe(gzip).pipe(response);
        return;
      }
      if (mode === "buffered") {
        const chunks = [];
        upstreamResponse.on("data", (chunk) => chunks.push(chunk));
        upstreamResponse.on("end", () => {
          setTimeout(() => {
            response.writeHead(200, headers);
            response.end(Buffer.concat(chunks));
          }, 150);
        });
        return;
      }
      response.writeHead(200, headers);
      if (mode === "idle" && Number(lastEventId) === 0) {
        upstreamResponse.pipe(response, { end: false });
        const idleTimeout = setTimeout(() => {
          upstreamResponse.destroy();
          if (!response.writableEnded) response.end();
        }, 30);
        upstreamResponse.on("end", () => {
          clearTimeout(idleTimeout);
          if (!response.writableEnded) response.end();
        });
        return;
      }
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => response.destroy());
  upstream.end();
}

async function runBrowserAcceptance(page, mode, engine) {
  return page.evaluate(
    async ({ acceptanceMode, browserEngine }) => {
      const sequences = [];
      let heartbeatCount = 0;
      let lastSequence = 0;
      let terminal = false;
      let contentType = "";
      let firstFrameMs;
      const startedAt = performance.now();
      let attemptCount = 0;

      while (!terminal && attemptCount < 2) {
        attemptCount += 1;
        const response = await fetch(
          `/events?mode=${acceptanceMode}&engine=${browserEngine}`,
          {
            headers: {
              Accept: "text/event-stream",
              "Last-Event-ID": String(lastSequence),
            },
          },
        );
        if (!response.ok || response.body === null)
          throw new Error("SSE fetch was unavailable");
        contentType = response.headers.get("content-type") ?? "";
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        while (true) {
          const { done, value } = await reader.read();
          buffered += decoder.decode(value, { stream: !done });
          let boundary = buffered.indexOf("\n\n");
          while (boundary >= 0) {
            if (firstFrameMs === undefined)
              firstFrameMs = performance.now() - startedAt;
            const frame = buffered.slice(0, boundary);
            buffered = buffered.slice(boundary + 2);
            if (frame.startsWith(":")) heartbeatCount += 1;
            else {
              const idLine = frame
                .split("\n")
                .find((line) => line.startsWith("id:"));
              const dataLine = frame
                .split("\n")
                .find((line) => line.startsWith("data:"));
              const sequence = Number(idLine?.slice(3).trim());
              const data = JSON.parse(dataLine?.slice(5).trim() ?? "{}");
              if (sequence > lastSequence) {
                sequences.push(sequence);
                lastSequence = sequence;
              }
              terminal = data.terminal === true;
            }
            boundary = buffered.indexOf("\n\n");
          }
          if (done) break;
        }
        if (acceptanceMode !== "idle" && !terminal) break;
      }
      return {
        attemptCount,
        contentType,
        firstFrameMs: firstFrameMs ?? -1,
        heartbeatCount,
        sequences,
      };
    },
    { acceptanceMode: mode, browserEngine: engine },
  );
}

function eventFrame(sequence, terminal) {
  return `id: ${sequence}\nevent: run\ndata: ${JSON.stringify({ sequence, terminal })}\n\n`;
}

async function writeSplit(response, value) {
  const midpoint = Math.max(1, Math.floor(value.length / 2));
  response.write(value.slice(0, midpoint));
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  response.write(value.slice(midpoint));
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
}

function close(server) {
  return new Promise((resolveClose) => server.close(resolveClose));
}

function addressPort(server) {
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Acceptance server did not bind a TCP port");
  return address.port;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sanitizeFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s)]+/giu, "[url]")
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 2_000);
}
