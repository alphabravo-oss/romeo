import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const serverEntry = resolve(root, "apps/app/.output/server/index.mjs");
const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = [];
const server = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: {
    ...process.env,
    APP_ORIGIN: baseUrl,
    DEV_SEEDED_LOGIN: "true",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [server.stdout, server.stderr]) {
  stream?.on("data", (chunk) => {
    output.push(chunk.toString("utf8"));
    if (output.length > 100) output.shift();
  });
}

try {
  await waitForServer(`${baseUrl}/api/v1/health`, 30_000);
  const loginHtml = await expectHtml("/login");
  assertIncludes(loginHtml, "rm-login-shell", "server-rendered login shell");
  assertIncludes(loginHtml, "<main", "server-rendered main landmark");
  assertExcludes(loginHtml, "rm-loading", "root ClientOnly loading fallback");

  const workspaceHtml = await expectHtml("/");
  assertIncludes(workspaceHtml, "<main", "server-rendered workspace landmark");

  console.log(
    JSON.stringify(
      {
        schema: "romeo.ssr-render-smoke.v1",
        status: "passed",
        routes: ["/login", "/"],
      },
      null,
      2,
    ),
  );
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => server.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function expectHtml(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `${path} returned ${response.status}.\n${output.join("").slice(-4_000)}`,
    );
  }
  if (!body.startsWith("<!DOCTYPE html>")) {
    throw new Error(`${path} did not return an HTML document.`);
  }
  return body;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `SSR server exited with ${server.exitCode}.\n${output.join("").slice(-4_000)}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`SSR server did not become healthy at ${url}.`);
}

function assertIncludes(body, expected, label) {
  if (!body.includes(expected)) {
    throw new Error(`SSR response is missing ${label} (${expected}).`);
  }
}

function assertExcludes(body, unexpected, label) {
  if (body.includes(unexpected)) {
    throw new Error(`SSR response still contains ${label} (${unexpected}).`);
  }
}

async function reservePort() {
  const listener = createServer();
  await new Promise((resolveListen, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolveListen);
  });
  const address = listener.address();
  const selectedPort =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolveClose, reject) => {
    listener.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolveClose();
    });
  });
  if (selectedPort === 0)
    throw new Error("Unable to reserve an SSR smoke port.");
  return selectedPort;
}
