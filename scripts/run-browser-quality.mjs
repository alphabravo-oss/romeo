import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.ROMEO_QUALITY_PORT ?? "12049");
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(
  "corepack",
  [
    "pnpm",
    "--filter",
    "@romeo/app",
    "exec",
    "vite",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: root,
    env: { ...process.env, DEV_SEEDED_LOGIN: "true" },
    stdio: ["ignore", "inherit", "inherit"],
  },
);

try {
  await waitForHealth(`${baseUrl}/api/v1/health`, 30_000);
  await runBrowserScript("scripts/browser-chat-acceptance.mjs", baseUrl);
  await runBrowserScript("scripts/browser-engine-matrix.mjs", baseUrl, {
    ROMEO_BROWSER_ENGINES:
      process.env.ROMEO_BROWSER_ENGINES ?? "chromium,firefox,webkit",
  });
  await runBrowserScript("scripts/run-sse-browser-acceptance.mjs", baseUrl, {
    ROMEO_BROWSER_ENGINES:
      process.env.ROMEO_BROWSER_ENGINES ?? "chromium,firefox,webkit",
  });
  await runBrowserScript("scripts/admin-console-audit.mjs", baseUrl);
  await runBrowserScript("scripts/browser-visual-baselines.mjs", baseUrl);
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => server.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Romeo quality server exited with ${server.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Romeo quality server did not become healthy at ${url}.`);
}

async function runBrowserScript(script, url, environment = {}) {
  const child = spawn("node", [script], {
    cwd: root,
    env: {
      ...process.env,
      ROMEO_BASE_URL: url,
      ...environment,
    },
    stdio: "inherit",
  });
  const status = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code));
  });
  if (status !== 0) {
    throw new Error(`${script} exited with status ${status ?? 1}.`);
  }
}
