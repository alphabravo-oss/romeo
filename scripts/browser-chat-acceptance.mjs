import { spawn, spawnSync } from "node:child_process";

const baseUrl = process.env.ROMEO_BASE_URL ?? "http://127.0.0.1:3000";
const session = `romeo-chat-${process.pid}`;
const secondSession = `${session}-second`;
const imageProviderPort = 32_000 + (process.pid % 1_000);
const imageProvider = startImageProvider(imageProviderPort);

try {
  run("open", baseUrl);
  run("wait", "--load", "networkidle");
  const initial = run("snapshot", "-i");
  for (const required of [
    "New chat",
    "Message",
    "More actions",
    "Search the web",
    "Send message",
  ])
    assert(
      initial.includes(required),
      `missing initial chat control: ${required}`,
    );
  run("press", "Tab");
  const skipLink = JSON.parse(
    evaluate(`JSON.stringify({
    text: document.activeElement?.textContent?.trim(),
    href: document.activeElement?.getAttribute("href"),
  })`),
  );
  assert(
    skipLink.text === "Skip to chat" && skipLink.href === "#main-content",
    "keyboard skip link is not first in focus order",
  );
  run("press", "Enter");
  assert(
    JSON.parse(evaluate(`JSON.stringify(document.activeElement?.id)`)) ===
      "main-content",
    "skip link did not focus the chat content",
  );
  const axeViolations = axeViolationsForCurrentPage();
  assert(
    axeViolations.length === 0,
    `axe violations: ${JSON.stringify(axeViolations)}`,
  );

  run(
    "eval",
    `([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "New chat"))?.click()`,
  );
  run("wait", "250");
  run(
    "fill",
    "#prompt",
    "Browser acceptance **bold**\n\n```typescript\nconst parity: boolean = true;\n```",
  );
  run("click", 'button[aria-label="Send message"]');
  run("wait", "1500");

  const rendered = JSON.parse(
    evaluate(`JSON.stringify({
    bold: [...document.querySelectorAll("strong")].some((node) => node.textContent === "bold"),
    fencedBlocks: document.querySelectorAll(".rm-codeblock pre").length,
    highlightedTokens: document.querySelectorAll(".rm-codeblock .token, .rm-codeblock code.hljs").length,
    codeCopyActions: [...document.querySelectorAll(".rm-codeblock button")].filter((button) => button.textContent?.includes("Copy")).length,
    messageCopyActions: [...document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Copy").length,
  })`),
  );
  assert(rendered.bold, "Markdown bold was not rendered");
  assert(
    rendered.fencedBlocks >= 2,
    "fenced code was not rendered for the turn",
  );
  assert(
    rendered.highlightedTokens >= 2,
    "syntax highlighting tokens were not rendered",
  );
  assert(rendered.codeCopyActions >= 2, "code copy controls were not rendered");
  assert(
    rendered.messageCopyActions >= 2,
    "message copy controls were not rendered",
  );

  run("reload");
  run("wait", "--load", "networkidle");
  const persisted = JSON.parse(
    evaluate(`JSON.stringify({
    codeBlocks: document.querySelectorAll(".rm-codeblock").length,
    modelSelector: [...document.querySelectorAll("button")].some((button) => button.getAttribute("aria-haspopup") === "listbox" || button.textContent?.toLowerCase().includes("compatible")),
  })`),
  );
  assert(persisted.codeBlocks >= 2, "chat messages did not survive reload");
  assert(
    persisted.modelSelector,
    "model selector was not available after reload",
  );

  seedAndAttachBrowserFixtures();
  run(
    "wait",
    "--fn",
    `(() => { const items = [...document.querySelectorAll(".rm-pending-attachment")]; return items.some((node) => node.textContent?.includes("browser-source.txt")) && items.some((node) => node.textContent?.includes("browser-image.png") || node.querySelector("img")?.alt === "browser-image.png"); })()`,
  );
  run("fill", "#prompt", "Use both browser acceptance attachments.");
  run("click", 'button[aria-label="Send message"]');
  run(
    "wait",
    "--fn",
    `document.querySelectorAll(".rm-attachment-with-retention").length >= 2`,
  );
  const attached = JSON.parse(
    evaluate(`JSON.stringify({
    names: [...document.querySelectorAll(".rm-attachment-with-retention")].map((node) => node.textContent),
    retained: [...document.querySelectorAll(".rm-attachment-with-retention input[type=checkbox]")].map((input) => input.checked),
  })`),
  );
  assert(
    attached.names.some((name) => name.includes("browser-source.txt")),
    "document upload was not persisted",
  );
  assert(
    attached.names.some((name) => name.includes("browser-image.png")),
    "image upload was not persisted",
  );
  assert(
    attached.retained.length === 2 && attached.retained.every(Boolean),
    "new attachments were not retained by default",
  );
  const attachmentAxeViolations = axeViolationsForCurrentPage();
  assert(
    attachmentAxeViolations.length === 0,
    `attachment chat axe violations: ${JSON.stringify(attachmentAxeViolations)}`,
  );

  clickComposerMenuItem("Inspect context");
  run("wait", ".rm-context-body");
  const retainedContext = run("get", "text", ".rm-context-inspector");
  assert(
    retainedContext.includes("1 retained document(s)"),
    "context inspector omitted the retained document",
  );
  assert(
    retainedContext.includes("1 retained image(s)"),
    "context inspector omitted the retained image",
  );
  for (const section of [
    "Estimated input",
    "Usable budget",
    "Remaining",
    "History",
    "Files and knowledge",
    "Provider messages",
  ]) {
    assert(
      retainedContext.includes(section),
      `context inspector omitted section: ${section}`,
    );
  }
  run("click", 'button[aria-label="Close context inspector"]');

  run(
    "eval",
    `([...document.querySelectorAll(".rm-attachment-with-retention")].find((node) => node.textContent?.includes("browser-source.txt"))?.querySelector("input[type=checkbox]"))?.click()`,
  );
  run("wait", "300");
  clickComposerMenuItem("Inspect context");
  run("wait", ".rm-context-body");
  const releasedContext = run("get", "text", ".rm-context-inspector");
  assert(
    releasedContext.includes("0 retained document(s)"),
    "attachment retention disablement was not reflected in context",
  );
  assert(
    releasedContext.includes("1 retained image(s)"),
    "unmodified image retention was not preserved",
  );
  run("click", 'button[aria-label="Close context inspector"]');

  run("reload");
  run("wait", "--load", "networkidle");
  run(
    "wait",
    "--fn",
    `document.querySelectorAll(".rm-attachment-with-retention").length >= 2`,
  );
  const retainedAfterReload = JSON.parse(
    evaluate(`JSON.stringify(Object.fromEntries(
    [...document.querySelectorAll(".rm-attachment-with-retention")].map((node) => [
      node.textContent?.includes("browser-source.txt") ? "document" : node.textContent?.includes("browser-image.png") ? "image" : "unknown",
      node.querySelector("input[type=checkbox]")?.checked,
    ]),
  ))`),
  );
  assert(
    retainedAfterReload.document === false,
    "document retention disablement did not survive reload",
  );
  assert(
    retainedAfterReload.image === true,
    "image retention did not survive reload",
  );

  run(
    "eval",
    `([...document.querySelectorAll(".rm-attachment-with-retention")].find((node) => node.textContent?.includes("browser-source.txt"))?.querySelector(".rm-attachment-tile"))?.click()`,
  );
  run("wait", ".rm-source-viewer");
  const sourceViewer = JSON.parse(
    evaluate(`JSON.stringify({
    title: document.querySelector(".rm-ui-dialog__title")?.textContent,
    iframe: Boolean(document.querySelector(".rm-source-viewer iframe[sandbox]")),
    original: Boolean(document.querySelector(".rm-source-viewer a[target=_blank]")),
  })`),
  );
  assert(
    sourceViewer.title === "browser-source.txt",
    "source viewer opened the wrong document",
  );
  assert(
    sourceViewer.iframe && sourceViewer.original,
    "source viewer controls were incomplete",
  );
  run("click", '.rm-ui-dialog button[aria-label="Close"]');

  clickComposerMenuItem("Reusable files");
  run("wait", ".rm-ui-dialog");
  const reusableFiles = run("get", "text", ".rm-ui-dialog");
  assert(
    reusableFiles.includes("browser-source.txt") &&
      reusableFiles.includes("browser-image.png"),
    "uploaded files were not reusable from the library",
  );
  run("click", '.rm-ui-dialog button[aria-label="Close"]');

  assertModelPinsAndSelectionSync();
  assertContextBudgetOverflow();
  assertQueuedReloadRecovery();
  assertShareAndExport();
  assertPromptNotesMemoryAndTemporaryChat();
  assertImageGeneration(imageProviderPort);
  assertKeyboardAndFocusNavigation();

  assertNarrowViewportInteractions(390, 844, "mobile");
  assertNarrowViewportInteractions(768, 1024, "tablet");
  run("set", "viewport", "390", "844");
  run("set", "media", "reduced-motion");
  const reducedMotion = JSON.parse(
    evaluate(`JSON.stringify({
    preferred: matchMedia("(prefers-reduced-motion: reduce)").matches,
    transitionDuration: getComputedStyle(document.querySelector(".rm-send-button")).transitionDuration,
  })`),
  );
  assert(
    reducedMotion.preferred,
    "reduced-motion media emulation was not applied",
  );
  assert(
    reducedMotion.transitionDuration === "1e-05s",
    "animations were not reduced for the system preference",
  );

  assertComposerLocalization();

  for (const route of ["/settings", "/admin?section=providers"]) {
    run("open", `${baseUrl}${route}`);
    run("wait", "--load", "networkidle");
    const violations = axeViolationsForCurrentPage();
    assert(
      violations.length === 0,
      `${route} axe violations: ${JSON.stringify(violations)}`,
    );
  }

  assertProviderSetupAndDiagnostics();

  console.log("Romeo expanded core chat browser acceptance passed.");
} finally {
  run("close", { allowFailure: true });
  runFor(secondSession, "close", { allowFailure: true });
  imageProvider.kill("SIGTERM");
}

function seedAndAttachBrowserFixtures() {
  const fileInput = JSON.parse(
    evaluate(`JSON.stringify((() => {
    const input = document.querySelector("#chat-image-attachment");
    return { multiple: input?.multiple, accept: input?.accept, disabled: input?.disabled };
  })())`),
  );
  assert(
    fileInput.multiple && !fileInput.disabled,
    "file input was not available for multiple attachments",
  );
  for (const accepted of [
    "image/png",
    "application/pdf",
    ".docx",
    "text/plain",
  ]) {
    assert(
      fileInput.accept.includes(accepted),
      `file input omitted accepted type: ${accepted}`,
    );
  }
  run(
    "eval",
    `(async () => {
    const encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlJkAAAAASUVORK5CYII=";
    const fixtures = [
      { fileName: "browser-source.txt", mimeType: "text/plain", dataBase64: btoa("browser reusable source sentinel") },
      { fileName: "browser-image.png", mimeType: "image/png", dataBase64: encoded },
    ];
    for (const fixture of fixtures) {
      const sizeBytes = Uint8Array.from(atob(fixture.dataBase64), (value) => value.charCodeAt(0)).byteLength;
      const response = await fetch("/api/v1/files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...fixture, sizeBytes, workspaceId: "workspace_default", purpose: "chat_attachment" }),
      });
      if (!response.ok) throw new Error(await response.text());
    }
    return fixtures.length;
  })()`,
  );
  run("reload");
  run("wait", "--load", "networkidle");
  for (const fileName of ["browser-source.txt", "browser-image.png"]) {
    clickComposerMenuItem("Reusable files");
    run("wait", ".rm-ui-dialog");
    const selected = evaluate(`Boolean((() => {
      const row = [...document.querySelectorAll(".rm-ui-dialog .rm-list-row")].find((item) => item.textContent?.includes(${JSON.stringify(fileName)}));
      const button = row?.querySelector(":scope > button:first-of-type");
      button?.click();
      return button;
    })())`);
    assert(selected, `reusable file was absent from the library: ${fileName}`);
    run("wait", "--fn", `!document.querySelector(".rm-ui-dialog")`);
    run(
      "wait",
      "--fn",
      `([...document.querySelectorAll(".rm-pending-attachment")].some((node) => node.textContent?.includes(${JSON.stringify(fileName)}) || node.querySelector("img")?.alt === ${JSON.stringify(fileName)}))`,
    );
  }
}

function assertModelPinsAndSelectionSync() {
  run("click", ".rm-composer-model-select");
  run("wait", '[role="listbox"]');
  run(
    "eval",
    `([...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Pin Ollama llama3.2"))?.click()`,
  );
  run("wait", 'button[aria-label="Unpin Ollama llama3.2"]');

  runFor(secondSession, "open", baseUrl);
  runFor(secondSession, "wait", "--load", "networkidle");
  runFor(secondSession, "click", ".rm-composer-model-select");
  runFor(secondSession, "wait", '[role="listbox"]');
  runFor(secondSession, "wait", 'button[aria-label="Unpin Ollama llama3.2"]');
  const secondMenu = runFor(secondSession, "snapshot", "-i");
  assert(
    secondMenu.includes("Unpin Ollama llama3.2"),
    "model pin did not sync to a second browser session",
  );
  runFor(
    secondSession,
    "eval",
    `([...document.querySelectorAll('[role="option"]')].find((button) => button.textContent?.includes("Ollama llama3.2")))?.click()`,
  );
  runFor(secondSession, "wait", "500");
  runFor(secondSession, "reload");
  runFor(secondSession, "wait", "--load", "networkidle");
  const secondSelected = runFor(
    secondSession,
    "get",
    "text",
    ".rm-composer-model-select",
  );
  assert(
    secondSelected.includes("Ollama llama3.2"),
    "per-chat model selection did not survive reload",
  );

  run("reload");
  run("wait", "--load", "networkidle");
  const firstSelected = run("get", "text", ".rm-composer-model-select");
  assert(
    firstSelected.includes("Ollama llama3.2"),
    "per-chat model selection did not sync back to the first browser session",
  );
}

function assertContextBudgetOverflow() {
  run(
    "eval",
    `(() => {
    const input = document.querySelector("#prompt");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(input, "overflow ".repeat(7000));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.value.length;
  })()`,
  );
  clickComposerMenuItem("Inspect context");
  run("wait", ".rm-context-inspector .rm-composer-error");
  const error = run("get", "text", ".rm-context-inspector .rm-composer-error");
  assert(
    error.toLowerCase().includes("context window"),
    "context budget overflow did not return a clear failure",
  );
  run("click", 'button[aria-label="Close context inspector"]');
  run("fill", "#prompt", "");
}

function assertQueuedReloadRecovery() {
  run("click", 'button[aria-label="New chat"]');
  run("fill", "#prompt", "Browser queue recovery anchor");
  run("click", 'button[aria-label="Send message"]');
  run(
    "wait",
    "--fn",
    `document.body.innerText.includes("Browser queue recovery anchor") && document.querySelector("#composer-status")?.textContent?.includes("Ready to send")`,
  );
  run("wait", ".rm-sidebar-item.active[data-chat-id]");
  const queuedPersisted = evaluate(`(async () => {
    const chatId = document.querySelector(".rm-sidebar-item.active")?.dataset.chatId;
    if (!chatId) return false;
    const queueResponse = await fetch("/api/v1/chats/" + encodeURIComponent(chatId) + "/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        content: "Browser queued continuation follower sentinel",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!queueResponse.ok) return false;
    const queued = await queueResponse.json();
    return queued.data.content === "Browser queued continuation follower sentinel" && queued.data.status === "queued";
  })()`);
  assert(queuedPersisted, "queued follower was not durably persisted");
  run("reload");
  run("wait", "--load", "networkidle");
  run(
    "wait",
    "--fn",
    `document.body.innerText.includes("Browser queued continuation follower sentinel") && !document.body.innerText.includes("Queued: Browser queued continuation follower sentinel")`,
  );
  const recovered = run("get", "text", "body");
  assert(
    recovered.includes("Browser queued continuation follower sentinel"),
    "queued follower turn did not continue across reload",
  );
}

function assertShareAndExport() {
  run(
    "eval",
    `(async () => {
    const response = await fetch("/api/v1/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "workspace_default", title: "Browser share export chat" }),
    });
    if (!response.ok) throw new Error(await response.text());
  })()`,
  );
  run("reload");
  run("wait", "--load", "networkidle");
  run(
    "wait",
    "--fn",
    `document.body.innerText.includes("Browser share export chat")`,
  );
  run(
    "eval",
    `(() => {
    const row = [...document.querySelectorAll(".rm-sidebar-item")].find((item) => item.textContent?.includes("Browser share export chat"));
    row?.querySelector('button[aria-label^="Chat actions for"]')?.focus();
  })()`,
  );
  run("press", "Enter");
  run("wait", ".rm-ui-menu");
  run(
    "eval",
    `([...document.querySelectorAll('.rm-ui-menu [role="menuitem"]')].find((item) => item.textContent?.trim() === "Share"))?.focus()`,
  );
  run("press", "Enter");
  run("wait", ".rm-ui-dialog");
  assert(
    run("get", "text", ".rm-ui-dialog").includes("Current access"),
    "chat sharing dialog did not expose governed access state",
  );
  run("click", '.rm-ui-dialog button[aria-label="Close"]');

  run(
    "eval",
    `window.__romeoOpenedExport = ""; window.open = (url) => { window.__romeoOpenedExport = String(url); return null; }`,
  );
  run(
    "eval",
    `(() => {
    const row = [...document.querySelectorAll(".rm-sidebar-item")].find((item) => item.textContent?.includes("Browser share export chat"));
    row?.querySelector('button[aria-label^="Chat actions for"]')?.focus();
  })()`,
  );
  run("press", "Enter");
  run("wait", ".rm-ui-menu");
  run(
    "eval",
    `([...document.querySelectorAll('.rm-ui-menu [role="menuitem"]')].find((item) => item.textContent?.trim() === "Export JSON"))?.focus()`,
  );
  run("press", "Enter");
  const exportUrl = evaluate(`window.__romeoOpenedExport`);
  assert(
    exportUrl.includes("/api/v1/chats/") && exportUrl.includes("/export"),
    "chat JSON export action did not use the governed export endpoint",
  );
  run(
    "eval",
    `(async () => {
    const response = await fetch(window.__romeoOpenedExport);
    if (!response.ok) throw new Error(await response.text());
    const exported = await response.json();
    const payload = exported.data ?? exported;
    payload.chat = { ...(payload.chat ?? {}), title: "Browser imported chat" };
    const file = new File([JSON.stringify(payload)], "browser-import.json", { type: "application/json" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector("#import-chat-file");
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`,
  );
  run(
    "wait",
    "--fn",
    `document.body.innerText.includes("Browser imported chat")`,
  );
}

function assertPromptNotesMemoryAndTemporaryChat() {
  run(
    "eval",
    `(async () => {
    const response = await fetch("/api/v1/prompt-templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Browser prompt template",
        body: "Browser prompt insertion sentinel",
        visibility: "workspace",
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  })()`,
  );
  run("reload");
  run("wait", "--load", "networkidle");
  clickComposerMenuItem("Prompt library");
  run("wait", ".rm-ui-dialog");
  run(
    "wait",
    "--fn",
    `document.querySelector(".rm-ui-dialog")?.textContent?.includes("Browser prompt template")`,
  );
  const promptSelected = evaluate(`Boolean((() => {
    const row = [...document.querySelectorAll(".rm-ui-dialog .rm-list-row")]
      .find((item) => item.textContent?.includes("Browser prompt template"));
    row?.click();
    return row;
  })())`);
  assert(promptSelected, "seeded prompt was absent from the composer library");
  assert(
    run("get", "value", "#prompt").includes(
      "Browser prompt insertion sentinel",
    ),
    "prompt library did not materialize into the composer",
  );
  run("fill", "#prompt", "");

  run("open", `${baseUrl}/settings?section=notes`);
  run("wait", "--load", "networkidle");
  run(
    "eval",
    `([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add note"))?.click()`,
  );
  run("wait", "#content-title");
  run("fill", "#content-title", "Browser reusable note");
  run("fill", "#content-body", "Browser note insertion sentinel");
  run("click", '.rm-ui-dialog button[type="submit"]');
  run(
    "wait",
    "--fn",
    `document.body.innerText.includes("Browser reusable note") && !document.querySelector(".rm-ui-dialog")`,
  );

  run("open", `${baseUrl}/settings?section=memories`);
  run("wait", "--load", "networkidle");
  run(
    "eval",
    `([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add memory"))?.click()`,
  );
  run("wait", "#content-title");
  run("fill", "#content-title", "Browser controlled memory");
  run("fill", "#content-body", "Browser memory context sentinel");
  run("click", '.rm-ui-dialog button[type="submit"]');
  run(
    "wait",
    "--fn",
    `document.body.innerText.includes("Browser controlled memory") && !document.querySelector(".rm-ui-dialog")`,
  );
  const memoryRow = `.rm-list-row`;
  run(
    "eval",
    `(() => {
    const row = [...document.querySelectorAll(${JSON.stringify(memoryRow)})]
      .find((item) => item.textContent?.includes("Browser controlled memory"));
    [...(row?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.trim() === "Pin")?.click();
  })()`,
  );
  run(
    "wait",
    "--fn",
    `Boolean([...document.querySelectorAll(".rm-list-row")].find((item) => item.textContent?.includes("Browser controlled memory"))?.textContent?.includes("Unpin"))`,
  );

  run("open", baseUrl);
  run("wait", "--load", "networkidle");
  clickComposerMenuItem("Insert note");
  run("wait", ".rm-ui-dialog");
  run("fill", 'input[aria-label="Search notes"]', "Browser reusable note");
  run(
    "wait",
    "--fn",
    `Boolean([...document.querySelectorAll(".rm-ui-dialog .rm-list-row")].find((item) => item.textContent?.includes("Browser reusable note")))`,
  );
  const noteSelected = evaluate(`Boolean((() => {
    const row = [...document.querySelectorAll(".rm-ui-dialog .rm-list-row")]
      .find((item) => item.textContent?.includes("Browser reusable note"));
    row?.click();
    return row;
  })())`);
  assert(noteSelected, "saved note was absent from the composer library");
  assert(
    run("get", "value", "#prompt").includes("Browser note insertion sentinel"),
    "note library did not insert note content",
  );
  run("fill", "#prompt", "");

  run("click", 'button[aria-label="Search the web"]');
  assert(
    evaluate(
      `document.querySelector('button[aria-label="Search the web"]')?.getAttribute("aria-pressed")`,
    ) === "true",
    "web-search composer control did not enable governed retrieval",
  );
  run("click", 'button[aria-label="Search the web"]');
  assert(
    evaluate(
      `document.querySelector('button[aria-label="Search the web"]')?.getAttribute("aria-pressed")`,
    ) === "false",
    "web-search composer control did not disable governed retrieval",
  );

  clickComposerMenuItem("Attach a webpage");
  run("wait", "#webpage-url");
  run("fill", "#webpage-url", "http://127.0.0.1:3000/private-browser-sentinel");
  run("click", '.rm-ui-dialog button[type="submit"]');
  run("wait", ".rm-ui-dialog .rm-composer-error");
  const governedUrlFailure = run(
    "get",
    "text",
    ".rm-ui-dialog .rm-composer-error",
  );
  assert(
    /private|local|address|allowed|blocked|disabled|administrator/iu.test(
      governedUrlFailure,
    ),
    "URL ingestion did not explain the governed policy rejection",
  );
  run("click", '.rm-ui-dialog button[aria-label="Close"]');

  const temporaryMenuFocused = evaluate(`(() => {
    const trigger = document.querySelector('button[aria-label="More chat actions"]');
    trigger?.focus();
    return Boolean(trigger);
  })()`);
  assert(temporaryMenuFocused, "temporary-chat menu was unavailable");
  run("press", "Enter");
  run("wait", ".rm-ui-menu");
  const temporaryActionFocused = evaluate(`(() => {
    const item = [...document.querySelectorAll('.rm-ui-menu [role="menuitem"]')]
      .find((candidate) => candidate.textContent?.includes("Temporary chat"));
    item?.focus();
    return Boolean(item);
  })()`);
  assert(temporaryActionFocused, "temporary-chat action was unavailable");
  run("press", "Enter");
  run("fill", "#prompt", "Browser temporary chat sentinel");
  run("click", 'button[aria-label="Send message"]');
  run(
    "wait",
    "--fn",
    `document.body.innerText.includes("Browser temporary chat sentinel")`,
  );
  run(
    "wait",
    "--fn",
    `(() => { const node = document.querySelector("#composer-status"); return node?.getAttribute("aria-live") === "polite" && node.textContent?.includes("Ready to send"); })()`,
  );
  const temporaryPersisted = evaluate(`(async () => {
    const response = await fetch("/api/v1/chats?workspaceId=workspace_default");
    const body = await response.json();
    return body.data.some((chat) => chat.temporary === true);
  })()`);
  assert(
    temporaryPersisted,
    "temporary-chat composer control did not create a governed temporary chat",
  );
}

function assertImageGeneration(port) {
  const seeded = evaluate(`(async () => {
    const create = await fetch("/api/v1/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "openai-compatible",
        name: "Browser image provider",
        baseUrl: ${JSON.stringify(`http://127.0.0.1:${imageProviderPort}/v1`)},
        modelIds: ["gpt-image-1"],
      }),
    });
    if (!create.ok) throw new Error(await create.text());
    const provider = (await create.json()).data;
    const sync = await fetch("/api/v1/providers/" + encodeURIComponent(provider.id) + "/sync", { method: "POST" });
    if (!sync.ok) throw new Error(await sync.text());
    const models = (await sync.json()).data;
    return models.find((model) => model.capabilities.imageGeneration === true)?.id ?? "";
  })()`);
  assert(
    typeof seeded === "string" && seeded.length > 0,
    "image-capable provider model was not discovered",
  );
  run("open", baseUrl);
  run("wait", "--load", "networkidle");
  clickComposerMenuItem("Generate image");
  run("wait", "#image-prompt");
  run("select", "#image-model", seeded);
  run("fill", "#image-prompt", "Browser governed image sentinel");
  run("click", '.rm-ui-dialog button[type="submit"]');
  run(
    "wait",
    "--fn",
    `Boolean([...document.querySelectorAll(".rm-pending-attachment img")].find((image) => image.alt?.startsWith("generated-")))`,
  );
  const generated = JSON.parse(
    evaluate(`JSON.stringify((() => {
    const image = [...document.querySelectorAll(".rm-pending-attachment img")].find((item) => item.alt?.startsWith("generated-"));
    return { alt: image?.alt, src: image?.getAttribute("src") };
  })())`),
  );
  assert(
    generated.alt?.endsWith(".png") && generated.src?.startsWith("blob:"),
    "generated image was not attached through the governed file path",
  );
  run(
    "eval",
    `(() => {
    const image = [...document.querySelectorAll(".rm-pending-attachment img")].find((item) => item.alt?.startsWith("generated-"));
    image?.closest(".rm-pending-attachment")?.querySelector('button[aria-label^="Remove "]')?.click();
  })()`,
  );
  run(
    "wait",
    "--fn",
    `![...document.querySelectorAll(".rm-pending-attachment img")].some((item) => item.alt?.startsWith("generated-"))`,
  );
}

function assertKeyboardAndFocusNavigation() {
  run("eval", `document.querySelector(".rm-composer-model-select")?.focus()`);
  run("press", "Enter");
  run("wait", '[role="listbox"]');
  const modelSearchFocused = evaluate(
    `document.activeElement?.getAttribute("aria-label") === "Search models"`,
  );
  assert(
    modelSearchFocused,
    "model picker did not move keyboard focus into search",
  );
  run("press", "ArrowDown");
  assert(
    evaluate(`document.activeElement?.getAttribute("role") === "option"`),
    "model picker ArrowDown did not focus an option",
  );
  run("press", "Escape");
  run("wait", "--fn", `!document.querySelector('[role="listbox"]')`);
  run(
    "wait",
    "--fn",
    `document.activeElement?.getAttribute("aria-label") === "Choose model"`,
  );
  assert(
    evaluate(
      `document.activeElement?.getAttribute("aria-label") === "Choose model"`,
    ),
    "model picker Escape did not restore trigger focus",
  );
  const focusStyle = JSON.parse(
    evaluate(`JSON.stringify((() => {
    const style = getComputedStyle(document.activeElement);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  })())`),
  );
  assert(
    focusStyle.outlineStyle !== "none" && focusStyle.outlineWidth !== "0px",
    "keyboard-focused model control had no visible focus ring",
  );

  run(
    "eval",
    `document.querySelector('button[aria-label="More actions"]')?.focus()`,
  );
  run("press", "Enter");
  run("wait", ".rm-ui-menu");
  assert(
    evaluate(`document.activeElement?.getAttribute("role") === "menuitem"`),
    "composer menu did not enter its actions by keyboard",
  );
  run("press", "Escape");
  run("wait", "--fn", `!document.querySelector(".rm-ui-menu")`);
  assert(
    evaluate(
      `document.activeElement?.getAttribute("aria-label") === "More actions"`,
    ),
    "composer menu Escape did not restore trigger focus",
  );

  clickComposerMenuItem("Prompt library");
  run("wait", ".rm-ui-dialog");
  assert(
    evaluate(
      `document.querySelector(".rm-ui-dialog")?.contains(document.activeElement)`,
    ),
    "dialog did not capture keyboard focus",
  );
  run("press", "Shift+Tab");
  assert(
    evaluate(
      `document.querySelector(".rm-ui-dialog")?.contains(document.activeElement)`,
    ),
    "dialog focus trap allowed Shift+Tab to escape",
  );
  run("press", "Escape");
  run("wait", "--fn", `!document.querySelector(".rm-ui-dialog")`);
  run(
    "wait",
    "--fn",
    `document.activeElement?.getAttribute("aria-label") === "More actions"`,
  );
  assert(
    evaluate(
      `document.activeElement?.getAttribute("aria-label") === "More actions"`,
    ),
    "dialog Escape did not restore opener focus",
  );

  const chatActionFocused = evaluate(`(() => {
    const trigger = document.querySelector('button[aria-label^="Chat actions for"]');
    trigger?.focus();
    return Boolean(trigger);
  })()`);
  assert(
    chatActionFocused,
    "sidebar chat action was unavailable for keyboard testing",
  );
  run("press", "Enter");
  run("wait", ".rm-ui-menu");
  run("press", "Tab");
  assert(
    evaluate(`document.activeElement?.getAttribute("role") === "menuitem"`),
    "sidebar menu did not enter its actions by keyboard",
  );
  run("press", "Escape");
  run("wait", "--fn", `!document.querySelector(".rm-ui-menu")`);
  assert(
    evaluate(
      `document.activeElement?.getAttribute("aria-label")?.startsWith("Chat actions for") === true`,
    ),
    "sidebar menu Escape did not restore trigger focus",
  );

  const messageCopyFocused = evaluate(`(() => {
    const button = document.querySelector('.rm-message-actions button[aria-label="Copy"]');
    button?.focus();
    return Boolean(button);
  })()`);
  assert(
    messageCopyFocused,
    "message copy action was unavailable for keyboard testing",
  );
  run("press", "Enter");
  run("wait", '.rm-message-actions button[aria-label="Copied"]');

  run("eval", `document.querySelector("#prompt")?.focus()`);
  run("fill", "#prompt", "Keyboard composer submit sentinel");
  run("press", "Enter");
  run(
    "wait",
    "--fn",
    `document.body.innerText.includes("Keyboard composer submit sentinel")`,
  );
  settleComposerRun();
  const status = JSON.parse(
    evaluate(`JSON.stringify((() => {
    const node = document.querySelector("#composer-status");
    return { live: node?.getAttribute("aria-live"), text: node?.textContent };
  })())`),
  );
  assert(
    status.live === "polite",
    "composer status was not announced to assistive technology",
  );
}

function assertNarrowViewportInteractions(width, height, label) {
  run("set", "viewport", String(width), String(height));
  evaluate(
    `([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "New chat"))?.click()`,
  );
  run("wait", "250");
  const snapshot = run("snapshot", "-i");
  assert(
    snapshot.includes("Message"),
    `composer is unavailable at the ${label} viewport`,
  );
  const layout = JSON.parse(
    evaluate(`JSON.stringify({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    composerRight: document.querySelector(".rm-composer")?.getBoundingClientRect().right,
  })`),
  );
  assert(
    layout.documentWidth <= layout.viewportWidth &&
      layout.composerRight <= layout.viewportWidth,
    `${label} chat layout overflowed horizontally`,
  );

  clickComposerMenuItem("Prompt library");
  run("wait", ".rm-ui-dialog");
  const dialogBounds = JSON.parse(
    evaluate(`JSON.stringify((() => {
    const rect = document.querySelector(".rm-ui-dialog")?.getBoundingClientRect();
    return { left: rect?.left, right: rect?.right, width: rect?.width };
  })())`),
  );
  assert(
    dialogBounds.left >= 0 &&
      dialogBounds.right <= width &&
      dialogBounds.width > 0,
    `${label} prompt dialog escaped the viewport`,
  );
  run("press", "Escape");
  run("wait", "--fn", `!document.querySelector(".rm-ui-dialog")`);

  if (label === "mobile") {
    run("click", 'button[aria-label="Choose model"]');
    run("wait", '[role="listbox"]');
    const modelBounds = JSON.parse(
      evaluate(`JSON.stringify((() => {
      const rect = document.querySelector('[role="listbox"]')?.getBoundingClientRect();
      return { left: rect?.left, right: rect?.right, width: rect?.width };
    })())`),
    );
    assert(
      modelBounds.left >= 0 &&
        modelBounds.right <= width &&
        modelBounds.width > 0,
      `${label} model picker escaped the viewport`,
    );
    run("press", "Escape");
  }

  run("focus", "#prompt");
  run("fill", "#prompt", `Keyboard ${label} composer sentinel`);
  run(
    "wait",
    "--fn",
    `!document.querySelector('button[aria-label="Send message"]')?.disabled`,
  );
  run("focus", "#prompt");
  run("press", "Enter");
  run(
    "wait",
    "--fn",
    `document.body.innerText.includes(${JSON.stringify(`Keyboard ${label} composer sentinel`)})`,
  );
  settleComposerRun();
}

function settleComposerRun() {
  run(
    "wait",
    "--fn",
    `(() => {
    const node = document.querySelector("#composer-status");
    return node?.getAttribute("aria-live") === "polite" &&
      (node.textContent?.includes("Ready to send") || node.textContent?.includes("Response in progress"));
  })()`,
  );
  const stopVisible = evaluate(
    `Boolean(document.querySelector('button[aria-label="Stop response"]'))`,
  );
  if (stopVisible) {
    run(
      "eval",
      `document.querySelector('button[aria-label="Stop response"]')?.click()`,
    );
    run(
      "wait",
      "--fn",
      `document.querySelector("#composer-status")?.textContent?.includes("Ready to send")`,
    );
  }
}

function assertComposerLocalization() {
  run("set", "viewport", "1280", "900");
  for (const locale of [
    {
      code: "es",
      activeSessions: "Sesiones activas",
      abuseControls: "Controles de abuso",
      admin: "Administración",
      agentAccess: "Acceso",
      agentSaveDraft: "Guardar borrador",
      agentStudio: "Configuración del asistente",
      agentTestConsole: "Consola de prueba",
      analyticsTitle: "Analítica",
      auditTitle: "Registro de auditoría",
      auditAnyOutcome: "Cualquier resultado",
      groupsTitle: "Grupos",
      groupsAdd: "Añadir grupo",
      groupsNew: "Nuevo grupo",
      organizationsTitle: "Organizaciones",
      deviceTokensTitle: "Tokens de dispositivo",
      deviceTokensAdd: "Añadir token de dispositivo",
      deviceTokensNew: "Nuevo token de dispositivo",
      impersonationRequests: "Solicitudes de suplantación",
      impersonationActiveSessions: "Sesiones activas",
      webhooksTitle: "Webhooks",
      webhooksAdd: "Añadir webhook",
      webhooksNew: "Nuevo webhook",
      connectedAppsTitle: "Aplicaciones conectadas",
      connectedAppsPosture: "Estado",
      connectedAppsAvailableProviders: "Proveedores disponibles",
      connectorSyncNone: "Todavía no hay sincronizaciones.",
      connectorSyncStarted: "Iniciada",
      dataConnectors: "Conectores de datos",
      connectorCatalog: "Catálogo",
      connectorAdd: "Añadir conector",
      connectorNew: "Nuevo conector de datos",
      skipToChat: "Saltar al chat",
      usageTitle: "Uso",
      usageTotals: "Totales",
      workspaceTools: "Herramientas",
      workspaceRunCalculator: "Ejecutar calculadora",
      workspaceVoice: "Voz",
      workspaceBindVoice: "Vincular voz",
      workspaceCollaboration: "Colaboración",
      workspaceShareAgent: "Compartir asistente",
      addMemory: "Añadir memoria",
      addStep: "Añadir paso",
      appearance: "Apariencia",
      apiKeys: "Claves API",
      authProviders: "Proveedores de autenticación",
      billing: "Facturación",
      chatActions: "Acciones del chat",
      changeRequests: "Solicitudes de cambio",
      createFolder: "Crear carpeta",
      createFolderDialog: "Crear carpeta de chats",
      configureAuth: "Configurar",
      dataDeletion: "Eliminación de datos",
      connections: "Conexiones",
      commandPalette: "Paleta de comandos",
      addConnection: "Añadir conexión",
      addProvider: "Añadir proveedor",
      exportJson: "Exportar JSON",
      fileLibrary: "Biblioteca de archivos",
      displayName: "Nombre visible",
      directorySync: "Sincronización del directorio",
      edgePosture: "Estado del perímetro",
      edgeSecurityPosture: "Estado de seguridad del perímetro",
      evals: "Evaluaciones",
      evalNewSuite: "Nueva suite",
      evalNewSuiteTitle: "Nueva suite de evaluación",
      evalDescription:
        "Prueba las respuestas del asistente con suites y rúbricas gobernadas.",
      filterByFolder: "Filtrar chats por carpeta",
      filterByTag: "Filtrar chats por etiqueta",
      files: "Archivos reutilizables",
      inspect: "Inspeccionar contexto",
      contextInspector: "Inspector de contexto",
      governedWebSearch: "Búsqueda web gobernada",
      governance: "Gobernanza",
      gaEvidence: "Evidencia de GA",
      goTo: "Ir a",
      keyboardShortcuts: "Atajos de teclado",
      knowledgeTitle: "Conocimiento",
      knowledgeAddBase: "Añadir base de conocimiento",
      knowledgeNewBase: "Nueva base de conocimiento",
      knowledgeAddSource: "Añadir fuente",
      model: "Elegir modelo",
      moreChatActions: "Más acciones de chat",
      modelPricing: "Precios de modelos",
      models: "Modelos",
      navConfiguration: "Configuración",
      newExportDsar: "Nueva exportación (DSAR)",
      notificationChannels: "Canales de notificación",
      newWorkflow: "Nuevo flujo de trabajo",
      serviceAccounts: "Cuentas de servicio",
      systemPosture: "Estado del sistema",
      syncDirectory: "Sincronizar directorio",
      tableOptions: "Opciones de tabla",
      tableSearch: "Buscar en la tabla",
      toolConnectors: "Conectores de herramientas",
      toolImportTool: "Importar herramienta",
      toolImportTitle: "Importar conector de herramienta",
      workflows: "Flujos de trabajo",
      voiceRecord: "Grabar entrada de voz",
      workspaceLifecycle: "Ciclo de vida del espacio de trabajo",
      chatLifecycle: "Ciclo de vida del chat",
      users: "Usuarios",
      userManage: "Administrar",
      userManageTitle: "Administrar usuario",
      moreActions: "Más acciones",
      promptTemplates: "Plantillas de instrucciones",
      promptAddTemplate: "Añadir plantilla",
      promptNewTemplate: "Nueva plantilla",
      policyChangeRequests: "Solicitudes de cambio de política",
      previewDeletion: "Previsualizar eliminación",
      quotaBuckets: "Cuotas",
      addQuota: "Añadir cuota",
      newQuota: "Nueva cuota",
      profileDescription: "Actualiza tu nombre visible o correo electrónico.",
      ready: "Listo para enviar.",
      ragRetrievalPolicy: "Política de recuperación RAG",
      readiness: "Preparación",
      retentionAccess: "Retención y acceso",
      replay: "Repetición",
      retrievalReplay: "Repetición de recuperación",
      temporaryExpiry: "Vence y desaparece del historial",
    },
    {
      code: "fr",
      activeSessions: "Sessions actives",
      abuseControls: "Contrôles d’abus",
      admin: "Administration",
      agentAccess: "Accès",
      agentSaveDraft: "Enregistrer le brouillon",
      agentStudio: "Configuration de l’assistant",
      agentTestConsole: "Console de test",
      analyticsTitle: "Analytique",
      auditTitle: "Journal d’audit",
      auditAnyOutcome: "Tout résultat",
      groupsTitle: "Groupes",
      groupsAdd: "Ajouter un groupe",
      groupsNew: "Nouveau groupe",
      organizationsTitle: "Organisations",
      deviceTokensTitle: "Jetons d’appareil",
      deviceTokensAdd: "Ajouter un jeton d’appareil",
      deviceTokensNew: "Nouveau jeton d’appareil",
      impersonationRequests: "Demandes d’usurpation",
      impersonationActiveSessions: "Sessions actives",
      webhooksTitle: "Webhooks",
      webhooksAdd: "Ajouter un webhook",
      webhooksNew: "Nouveau webhook",
      connectedAppsTitle: "Applications connectées",
      connectedAppsPosture: "État",
      connectedAppsAvailableProviders: "Fournisseurs disponibles",
      connectorSyncNone: "Aucune synchronisation.",
      connectorSyncStarted: "Démarrée",
      dataConnectors: "Connecteurs de données",
      connectorCatalog: "Catalogue",
      connectorAdd: "Ajouter un connecteur",
      connectorNew: "Nouveau connecteur de données",
      skipToChat: "Accéder à la discussion",
      usageTitle: "Utilisation",
      usageTotals: "Totaux",
      workspaceTools: "Outils",
      workspaceRunCalculator: "Exécuter la calculatrice",
      workspaceVoice: "Voix",
      workspaceBindVoice: "Associer la voix",
      workspaceCollaboration: "Collaboration",
      workspaceShareAgent: "Partager l’assistant",
      addMemory: "Ajouter une mémoire",
      addStep: "Ajouter une étape",
      appearance: "Apparence",
      apiKeys: "Clés API",
      authProviders: "Fournisseurs d’authentification",
      billing: "Facturation",
      chatActions: "Actions de la discussion",
      changeRequests: "Demandes de changement",
      createFolder: "Créer un dossier",
      createFolderDialog: "Créer un dossier de discussions",
      configureAuth: "Configurer",
      dataDeletion: "Suppression des données",
      connections: "Connexions",
      commandPalette: "Palette de commandes",
      addConnection: "Ajouter une connexion",
      addProvider: "Ajouter un fournisseur",
      exportJson: "Exporter en JSON",
      fileLibrary: "Bibliothèque de fichiers",
      displayName: "Nom affiché",
      directorySync: "Synchronisation de l’annuaire",
      edgePosture: "État périphérique",
      edgeSecurityPosture: "État de sécurité périphérique",
      evals: "Évaluations",
      evalNewSuite: "Nouvelle suite",
      evalNewSuiteTitle: "Nouvelle suite d’évaluation",
      evalDescription:
        "Testez les réponses de l’assistant avec des suites et grilles gouvernées.",
      filterByFolder: "Filtrer les discussions par dossier",
      filterByTag: "Filtrer les discussions par étiquette",
      files: "Fichiers réutilisables",
      inspect: "Inspecter le contexte",
      contextInspector: "Inspecteur de contexte",
      governedWebSearch: "Recherche web gouvernée",
      governance: "Gouvernance",
      gaEvidence: "Preuves de disponibilité générale",
      goTo: "Aller à",
      keyboardShortcuts: "Raccourcis clavier",
      knowledgeTitle: "Connaissances",
      knowledgeAddBase: "Ajouter une base de connaissances",
      knowledgeNewBase: "Nouvelle base de connaissances",
      knowledgeAddSource: "Ajouter une source",
      model: "Choisir un modèle",
      moreChatActions: "Plus d’actions de discussion",
      modelPricing: "Tarification des modèles",
      models: "Modèles",
      navConfiguration: "Configuration",
      newExportDsar: "Nouvelle exportation (DSAR)",
      notificationChannels: "Canaux de notification",
      newWorkflow: "Nouveau flux de travail",
      serviceAccounts: "Comptes de service",
      systemPosture: "État du système",
      syncDirectory: "Synchroniser l’annuaire",
      tableOptions: "Options du tableau",
      tableSearch: "Rechercher dans le tableau",
      toolConnectors: "Connecteurs d’outils",
      toolImportTool: "Importer un outil",
      toolImportTitle: "Importer un connecteur d’outil",
      workflows: "Flux de travail",
      voiceRecord: "Enregistrer une entrée vocale",
      workspaceLifecycle: "Cycle de vie de l’espace de travail",
      chatLifecycle: "Cycle de vie de la discussion",
      users: "Utilisateurs",
      userManage: "Gérer",
      userManageTitle: "Gérer l’utilisateur",
      moreActions: "Plus d’actions",
      promptTemplates: "Modèles d’invite",
      promptAddTemplate: "Ajouter un modèle",
      promptNewTemplate: "Nouveau modèle",
      policyChangeRequests: "Demandes de changement de politique",
      previewDeletion: "Prévisualiser la suppression",
      quotaBuckets: "Quotas",
      addQuota: "Ajouter un quota",
      newQuota: "Nouveau quota",
      profileDescription:
        "Mettez à jour votre nom affiché ou votre adresse e-mail.",
      ready: "Prêt à envoyer.",
      ragRetrievalPolicy: "Politique de récupération RAG",
      readiness: "Préparation",
      retentionAccess: "Conservation et accès",
      replay: "Rejeu",
      retrievalReplay: "Rejeu de récupération",
      temporaryExpiry: "Expire et disparaît de l’historique",
    },
  ]) {
    run("errors", "--clear");
    run(
      "eval",
      `localStorage.setItem("romeo:locale", ${JSON.stringify(locale.code)})`,
    );
    run("reload");
    run("wait", "--load", "networkidle");
    run("wait", `button[aria-label=${JSON.stringify(locale.model)}]`);
    const localized = JSON.parse(
      evaluate(`JSON.stringify({
      lang: document.documentElement.lang,
      filterTrigger: document.querySelector(${JSON.stringify(`button[aria-label="${locale.filterByTag} / ${locale.filterByFolder}"]`)})?.getAttribute("aria-label"),
      moreChatActions: document.querySelector(${JSON.stringify(`button[aria-label="${locale.moreChatActions}"]`)})?.getAttribute("aria-label"),
      moreActions: document.querySelector(${JSON.stringify(`button[aria-label="${locale.moreActions}"]`)})?.getAttribute("aria-label"),
      voiceRecord: document.querySelector(${JSON.stringify(`button[aria-label="${locale.voiceRecord}"]`)})?.getAttribute("aria-label"),
      status: document.querySelector("#composer-status")?.textContent,
      skipToChat: document.querySelector(".rm-skip-link")?.textContent?.trim(),
    })`),
    );
    assert(
      localized.lang === locale.code,
      `${locale.code} did not update the document language`,
    );
    assert(
      localized.filterTrigger ===
        `${locale.filterByTag} / ${locale.filterByFolder}`,
      `${locale.code} did not translate chat filters`,
    );
    assert(
      localized.moreActions === locale.moreActions,
      `${locale.code} did not translate the composer actions menu`,
    );
    assert(
      localized.voiceRecord === locale.voiceRecord,
      `${locale.code} did not translate voice recording controls`,
    );
    assert(
      localized.status?.includes(locale.ready),
      `${locale.code} did not translate the composer status`,
    );
    assert(
      localized.moreChatActions === locale.moreChatActions,
      `${locale.code} did not translate additional chat actions`,
    );
    assert(
      localized.skipToChat === locale.skipToChat,
      `${locale.code} did not translate the workspace skip link`,
    );
    run(
      "click",
      `button[aria-label=${JSON.stringify(locale.moreChatActions)}]`,
    );
    run("wait", ".rm-ui-menu");
    assert(
      run("get", "text", ".rm-ui-menu").includes(locale.temporaryExpiry),
      `${locale.code} did not translate temporary-chat guidance`,
    );
    run("press", "Escape");
    const localeErrors = run("errors");
    assert(
      !/hydration|did not match|server rendered/iu.test(localeErrors),
      `${locale.code} produced an SSR hydration mismatch: ${localeErrors}`,
    );

    clickComposerMenuItem(locale.files, locale.moreActions);
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.fileLibrary),
      `${locale.code} did not translate the reusable file library`,
    );
    run("press", "Escape");
    clickComposerMenuItem(locale.inspect, locale.moreActions);
    run("wait", ".rm-context-inspector");
    assert(
      run("get", "text", ".rm-context-inspector").includes(
        locale.contextInspector,
      ),
      `${locale.code} did not translate the context inspector`,
    );
    run(
      "click",
      `.rm-context-inspector button[aria-label=${JSON.stringify(locale.code === "es" ? "Cerrar inspector de contexto" : "Fermer l’inspecteur de contexte")}]`,
    );
    evaluate(
      `window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))`,
    );
    run("wait", ".rm-overlay-command");
    assert(
      run("get", "text", ".rm-overlay-command").includes(
        locale.goTo.toLocaleUpperCase(locale.code),
      ),
      `${locale.code} did not translate the command palette`,
    );
    assert(
      evaluate(
        `document.querySelector(".rm-overlay-command")?.getAttribute("aria-label")`,
      ) === locale.commandPalette,
      `${locale.code} did not translate the command palette label`,
    );
    run("press", "Escape");
    evaluate(`window.dispatchEvent(new CustomEvent("rm-shortcuts"))`);
    run("wait", ".rm-overlay-shortcuts");
    assert(
      run("get", "text", ".rm-overlay-shortcuts").includes(
        locale.keyboardShortcuts,
      ),
      `${locale.code} did not translate keyboard shortcuts`,
    );
    run("press", "Escape");

    run("click", `button[aria-label=${JSON.stringify(locale.createFolder)}]`);
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.createFolderDialog),
      `${locale.code} did not translate the folder dialog`,
    );
    run("press", "Escape");

    const actionOpened = evaluate(`Boolean((() => {
      const trigger = [...document.querySelectorAll('button[aria-label]')]
        .find((button) => button.getAttribute('aria-label')?.startsWith(${JSON.stringify(locale.chatActions)}));
      trigger?.focus();
      return trigger;
    })())`);
    assert(actionOpened, `${locale.code} did not translate chat action labels`);
    run("press", "Enter");
    run("wait", ".rm-ui-menu");
    assert(
      run("get", "text", ".rm-ui-menu").includes(locale.exportJson),
      `${locale.code} did not translate export actions`,
    );
    run("press", "Escape");

    evaluate(`fetch("/api/v1/me/interface-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: ${JSON.stringify(locale.code)} }),
    }).then((response) => { if (!response.ok) throw new Error("locale sync failed"); return response.json(); })`);
    run("open", `${baseUrl}/settings?section=interface`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.appearance),
      `${locale.code} did not translate interface settings`,
    );
    run("open", `${baseUrl}/settings?section=memories`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.addMemory),
      `${locale.code} did not translate memory settings`,
    );
    run("open", `${baseUrl}/settings?section=account`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.profileDescription),
      `${locale.code} did not translate profile settings`,
    );
    run("open", `${baseUrl}/settings?section=security`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.activeSessions),
      `${locale.code} did not translate security settings`,
    );
    run("open", `${baseUrl}/workspace?section=evals`);
    run("wait", "--load", "networkidle");
    const evalWorkspace = run("get", "text", "body");
    assert(
      evalWorkspace.includes(locale.evals),
      `${locale.code} did not translate eval workspace navigation`,
    );
    assert(
      evalWorkspace.includes(locale.evalDescription),
      `${locale.code} did not translate eval workspace guidance`,
    );
    assert(
      !evalWorkspace.includes("Model comparison"),
      `${locale.code} exposed the non-goal model-comparison UI`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.evalNewSuite)})))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.evalNewSuiteTitle),
      `${locale.code} did not translate eval suite creation`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/workspace?section=agents`);
    run("wait", "--load", "networkidle");
    const agentStudio = run("get", "text", "body");
    assert(
      agentStudio.includes(locale.agentStudio),
      `${locale.code} did not translate Agent Studio`,
    );
    assert(
      agentStudio.includes(locale.agentSaveDraft),
      `${locale.code} did not translate the agent draft form`,
    );
    assert(
      agentStudio.includes(locale.agentAccess),
      `${locale.code} did not translate agent access controls`,
    );
    assert(
      agentStudio.includes(locale.agentTestConsole),
      `${locale.code} did not translate the agent test console`,
    );
    run("open", `${baseUrl}/workspace?section=tools`);
    run("wait", "--load", "networkidle");
    const workspaceTools = run("get", "text", "body");
    assert(
      workspaceTools.includes(locale.workspaceTools),
      `${locale.code} did not translate workspace tools`,
    );
    assert(
      workspaceTools.includes(locale.workspaceRunCalculator),
      `${locale.code} did not translate workspace tool actions`,
    );
    run("open", `${baseUrl}/workspace?section=voice`);
    run("wait", "--load", "networkidle");
    const workspaceVoice = run("get", "text", "body");
    assert(
      workspaceVoice.includes(locale.workspaceVoice),
      `${locale.code} did not translate the workspace voice panel`,
    );
    assert(
      workspaceVoice.includes(locale.workspaceBindVoice),
      `${locale.code} did not translate workspace voice actions`,
    );
    run("open", `${baseUrl}/workspace?section=collaboration`);
    run("wait", "--load", "networkidle");
    const workspaceCollaboration = run("get", "text", "body");
    assert(
      workspaceCollaboration.includes(locale.workspaceCollaboration),
      `${locale.code} did not translate workspace collaboration`,
    );
    assert(
      workspaceCollaboration.includes(locale.workspaceShareAgent),
      `${locale.code} did not translate workspace sharing actions`,
    );
    run("open", `${baseUrl}/workspace?section=knowledge`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.knowledgeTitle),
      `${locale.code} did not translate knowledge workspace`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.knowledgeAddBase)})))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.knowledgeNewBase),
      `${locale.code} did not translate knowledge-base creation`,
    );
    run("press", "Escape");
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.knowledgeAddSource)})))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.knowledgeAddSource),
      `${locale.code} did not translate knowledge-source creation`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=providers`);
    run("wait", "--load", "networkidle");
    const providerAdmin = run("get", "text", "body");
    assert(
      providerAdmin.includes(locale.admin),
      `${locale.code} did not translate the admin console title`,
    );
    assert(
      providerAdmin.includes(
        locale.navConfiguration.toLocaleUpperCase(locale.code),
      ),
      `${locale.code} did not translate admin navigation groups`,
    );
    assert(
      providerAdmin.includes(locale.connections),
      `${locale.code} did not translate provider administration`,
    );
    assert(
      providerAdmin.includes(locale.models),
      `${locale.code} did not translate model administration`,
    );
    assert(
      providerAdmin.includes(locale.modelPricing),
      `${locale.code} did not translate model pricing administration`,
    );
    run("open", `${baseUrl}/admin?section=overview`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.readiness),
      `${locale.code} did not translate the admin overview`,
    );
    run("open", `${baseUrl}/admin?section=providers`);
    run("wait", "--load", "networkidle");
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.addProvider)})))?.click()`,
    );
    run("wait", '.rm-ui-dialog button[role="combobox"]');
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.addConnection),
      `${locale.code} did not translate provider setup`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=connections`);
    run("wait", "--load", "networkidle");
    const connectionsAdmin = run("get", "text", "body");
    assert(
      connectionsAdmin.includes(locale.toolConnectors),
      `${locale.code} did not translate tool-connector administration`,
    );
    assert(
      connectionsAdmin.includes(locale.connectorSyncNone) ||
        connectionsAdmin.includes(locale.connectorSyncStarted),
      `${locale.code} did not translate connector sync history`,
    );
    assert(
      connectionsAdmin.includes(locale.dataConnectors) &&
        connectionsAdmin.includes(locale.connectorCatalog),
      `${locale.code} did not translate data-connector administration`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === ${JSON.stringify(`+ ${locale.connectorAdd}`)}))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.connectorNew),
      `${locale.code} did not translate data-connector creation`,
    );
    run("press", "Escape");
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.toolImportTool)})))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.toolImportTitle),
      `${locale.code} did not translate tool-connector import`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=web-search`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.governedWebSearch),
      `${locale.code} did not translate governed web search administration`,
    );
    run("open", `${baseUrl}/admin?section=prompt-templates`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.promptTemplates),
      `${locale.code} did not translate prompt-template administration`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.promptAddTemplate)})))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.promptNewTemplate),
      `${locale.code} did not translate prompt-template creation`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=billing`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.billing),
      `${locale.code} did not translate billing administration`,
    );
    run("open", `${baseUrl}/admin?section=usage`);
    run("wait", "--load", "networkidle");
    const usageAdmin = run("get", "text", "body");
    assert(
      usageAdmin.includes(locale.usageTitle),
      `${locale.code} did not translate usage administration`,
    );
    assert(
      usageAdmin.includes(locale.usageTotals),
      `${locale.code} did not translate usage totals`,
    );
    assert(
      usageAdmin.includes(locale.quotaBuckets),
      `${locale.code} did not translate quota administration`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.addQuota)})))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.newQuota),
      `${locale.code} did not translate quota creation`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=analytics`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.analyticsTitle),
      `${locale.code} did not translate analytics administration`,
    );
    run("open", `${baseUrl}/admin?section=governance`);
    run("wait", "--load", "networkidle");
    const governanceAdmin = run("get", "text", "body");
    assert(
      governanceAdmin.includes(locale.governance),
      `${locale.code} did not translate governance administration`,
    );
    assert(
      governanceAdmin.includes(locale.retentionAccess),
      `${locale.code} did not translate retention administration`,
    );
    assert(
      governanceAdmin.includes(locale.dataDeletion),
      `${locale.code} did not translate data deletion administration`,
    );
    assert(
      governanceAdmin.includes(locale.previewDeletion),
      `${locale.code} did not translate data deletion preview controls`,
    );
    assert(
      governanceAdmin.includes(locale.workspaceLifecycle),
      `${locale.code} did not translate workspace lifecycle controls`,
    );
    assert(
      governanceAdmin.includes(locale.chatLifecycle),
      `${locale.code} did not translate chat lifecycle controls`,
    );
    run(
      "eval",
      `([...document.querySelectorAll('button[role="tab"]')].find((button) => button.textContent?.trim() === ${JSON.stringify(locale.code === "es" ? "Exportaciones de datos" : "Exportations de données")}))?.focus()`,
    );
    run("press", "Enter");
    run(
      "wait",
      "--fn",
      `document.body.innerText.includes(${JSON.stringify(locale.newExportDsar)})`,
    );
    run("open", `${baseUrl}/admin?section=posture`);
    run("wait", "--load", "networkidle");
    const postureAdmin = run("get", "text", "body");
    assert(
      postureAdmin.includes(locale.systemPosture),
      `${locale.code} did not translate system posture administration`,
    );
    assert(
      postureAdmin.includes(locale.gaEvidence),
      `${locale.code} did not translate GA evidence administration`,
    );
    run("open", `${baseUrl}/admin?section=abuse`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.abuseControls),
      `${locale.code} did not translate abuse-control administration`,
    );
    run(
      "eval",
      `([...document.querySelectorAll('button[role="tab"]')].find((button) => button.textContent?.trim() === ${JSON.stringify(locale.edgePosture)}))?.focus()`,
    );
    run("press", "Enter");
    run(
      "wait",
      "--fn",
      `document.body.innerText.includes(${JSON.stringify(locale.edgeSecurityPosture)})`,
    );
    run("open", `${baseUrl}/admin?section=auth-providers`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.authProviders),
      `${locale.code} did not translate authentication provider administration`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === ${JSON.stringify(locale.configureAuth)}))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.displayName),
      `${locale.code} did not translate authentication provider configuration`,
    );
    run("press", "Escape");
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === ${JSON.stringify(locale.syncDirectory)}))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.directorySync),
      `${locale.code} did not translate directory synchronization`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=users`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.users),
      `${locale.code} did not translate user administration`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === ${JSON.stringify(locale.userManage)}))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.userManageTitle),
      `${locale.code} did not translate user management`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=groups`);
    run("wait", "--load", "networkidle");
    const groupsAdmin = run("get", "text", "body");
    assert(
      groupsAdmin.includes(locale.groupsTitle),
      `${locale.code} did not translate group administration`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.groupsAdd)})))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.groupsNew),
      `${locale.code} did not translate group creation`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=organizations`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.organizationsTitle),
      `${locale.code} did not translate organization administration`,
    );
    run("open", `${baseUrl}/settings?section=device-tokens`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.deviceTokensTitle),
      `${locale.code} did not translate device-token settings`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.deviceTokensAdd)})))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.deviceTokensNew),
      `${locale.code} did not translate device-token creation`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=impersonation`);
    run("wait", "--load", "networkidle");
    const impersonationAdmin = run("get", "text", "body");
    assert(
      impersonationAdmin.includes(locale.impersonationRequests),
      `${locale.code} did not translate impersonation requests`,
    );
    assert(
      impersonationAdmin.includes(locale.impersonationActiveSessions),
      `${locale.code} did not translate impersonation sessions`,
    );
    run("open", `${baseUrl}/admin?section=audit`);
    run("wait", "--load", "networkidle");
    const auditAdmin = run("get", "text", "body");
    assert(
      auditAdmin.includes(locale.auditTitle),
      `${locale.code} did not translate audit administration`,
    );
    assert(
      auditAdmin.includes(locale.auditAnyOutcome),
      `${locale.code} did not translate audit filters`,
    );
    run("wait", `input[aria-label=${JSON.stringify(locale.tableSearch)}]`);
    assert(
      evaluate(
        `document.querySelector(${JSON.stringify(`button[aria-label="${locale.tableOptions}"]`)})?.getAttribute("aria-label")`,
      ) === locale.tableOptions,
      `${locale.code} did not translate shared table controls`,
    );
    run("open", `${baseUrl}/admin?section=notification-channels`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.notificationChannels),
      `${locale.code} did not translate notification administration`,
    );
    run("open", `${baseUrl}/admin?section=webhooks`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.webhooksTitle),
      `${locale.code} did not translate webhook administration`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.webhooksAdd)})))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.webhooksNew),
      `${locale.code} did not translate webhook creation`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=connected-apps`);
    run("wait", "--load", "networkidle");
    const connectedAppsAdmin = run("get", "text", "body");
    assert(
      connectedAppsAdmin.includes(locale.connectedAppsTitle),
      `${locale.code} did not translate connected-app administration`,
    );
    assert(
      connectedAppsAdmin.includes(locale.connectedAppsPosture) &&
        connectedAppsAdmin.includes(locale.connectedAppsAvailableProviders),
      `${locale.code} did not translate connected-app posture`,
    );
    run("open", `${baseUrl}/admin?section=access`);
    run("wait", "--load", "networkidle");
    const accessAdmin = run("get", "text", "body");
    assert(
      accessAdmin.includes(locale.apiKeys),
      `${locale.code} did not translate API key administration`,
    );
    assert(
      accessAdmin.includes(locale.serviceAccounts),
      `${locale.code} did not translate service account administration`,
    );
    run("open", `${baseUrl}/admin?section=workflows`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.workflows),
      `${locale.code} did not translate workflow administration`,
    );
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.includes(${JSON.stringify(locale.newWorkflow)})))?.click()`,
    );
    run("wait", ".rm-ui-dialog");
    assert(
      run("get", "text", ".rm-ui-dialog").includes(locale.addStep),
      `${locale.code} did not translate the workflow step builder`,
    );
    run("press", "Escape");
    run("open", `${baseUrl}/admin?section=rag`);
    run("wait", "--load", "networkidle");
    assert(
      run("get", "text", "body").includes(locale.ragRetrievalPolicy),
      `${locale.code} did not translate RAG policy administration`,
    );
    run(
      "eval",
      `([...document.querySelectorAll('button[role="tab"]')].find((button) => button.textContent?.trim() === ${JSON.stringify(locale.changeRequests)}))?.focus()`,
    );
    run("press", "Enter");
    run(
      "wait",
      "--fn",
      `document.body.innerText.includes(${JSON.stringify(locale.policyChangeRequests)})`,
    );
    run(
      "eval",
      `([...document.querySelectorAll('button[role="tab"]')].find((button) => button.textContent?.trim() === ${JSON.stringify(locale.replay)}))?.focus()`,
    );
    run("press", "Enter");
    run(
      "wait",
      "--fn",
      `document.body.innerText.includes(${JSON.stringify(locale.retrievalReplay)})`,
    );
    run("open", baseUrl);
    run("wait", "--load", "networkidle");
  }
  run("errors", "--clear");
  evaluate(`fetch("/api/v1/me/interface-preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ locale: "en" }),
  }).then((response) => { if (!response.ok) throw new Error("locale reset failed"); return response.json(); })`);
  run("eval", `localStorage.setItem("romeo:locale", "en")`);
  run("reload");
  run("wait", "--load", "networkidle");
  run("wait", 'button[aria-label="Choose model"]');
  const englishErrors = run("errors");
  assert(
    !/hydration|did not match|server rendered/iu.test(englishErrors),
    `en produced an SSR hydration mismatch: ${englishErrors}`,
  );
}

function startImageProvider(port) {
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlJkAAAAASUVORK5CYII=";
  const source = `
    const { createServer } = require("node:http");
    const port = Number(process.argv[1]);
    createServer((request, response) => {
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ok");
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ b64_json: ${JSON.stringify(png)}, revised_prompt: "browser governed image" }] }));
      });
    }).listen(port, "127.0.0.1");
  `;
  const child = spawn(process.execPath, ["-e", source, String(port)], {
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = spawnSync(
      "curl",
      ["-fsS", `http://127.0.0.1:${port}/health`],
      { encoding: "utf8" },
    );
    if (health.status === 0) return child;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  child.kill("SIGTERM");
  throw new Error("Image-provider acceptance fixture did not start.");
}

function assertProviderSetupAndDiagnostics() {
  const endpointName = `Browser acceptance endpoint ${process.pid}-${Date.now()}`;
  const endpointNameLiteral = JSON.stringify(endpointName);
  const secretSentinel = "browser-secret-must-not-render";
  const cardSelector = ".rm-connection-card";

  function openVllmDialog() {
    run(
      "eval",
      `([...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "+ Add provider"))?.click()`,
    );
    run("wait", "#connection-preset");
    run("click", "#connection-preset");
    run("wait", '[role="option"]');
    const optionRef = run("snapshot", "-i").match(
      /option "vLLM \/ compatible" \[ref=([^\]]+)\]/u,
    );
    assert(optionRef?.[1], "vLLM provider preset was not available");
    run("click", `@${optionRef[1]}`);
  }

  run("open", `${baseUrl}/admin?section=providers`);
  run("wait", "--load", "networkidle");
  openVllmDialog();
  const preset = JSON.parse(
    evaluate(`JSON.stringify({
    type: document.querySelector("#connection-type")?.textContent,
    name: document.querySelector("#connection-name")?.value,
    baseUrl: document.querySelector("#connection-url")?.value,
  })`),
  );
  assert(
    preset.type?.includes("OpenAI-compatible") &&
      preset.name === "vLLM" &&
      preset.baseUrl === "http://localhost:8000/v1",
    "provider preset did not populate the expected configuration",
  );
  run("fill", "#connection-name", endpointName);
  run("fill", "#connection-url", "http://127.0.0.1:9/v1");
  run("fill", "#connection-key", secretSentinel);
  run(
    "eval",
    `(() => { const summary = document.querySelector(".rm-ui-dialog .rm-advanced-settings summary"); if (!summary) return false; summary.click(); return true; })()`,
  );
  setTextareaValue("#connection-models", "browser-allowed-model");
  assertProviderFormValues({ apiKey: secretSentinel });
  run("click", '.rm-ui-dialog button[type="submit"]');
  run(
    "wait",
    "--fn",
    `Boolean(document.querySelector(".rm-ui-dialog .rm-ui-inline-error")) || (!document.querySelector(".rm-ui-dialog") && Boolean([...document.querySelectorAll("${cardSelector}")].find((card) => card.textContent?.includes(${endpointNameLiteral}))))`,
  );
  const secretFailure = evaluate(
    `document.querySelector(".rm-ui-dialog .rm-ui-inline-error")?.textContent ?? null`,
  );
  assert(
    !run("get", "text", "body").includes(secretSentinel),
    "provider setup error rendered the submitted credential",
  );

  if (secretFailure !== null) {
    assert(
      secretFailure.includes(
        "Managed secret encryption key must be configured",
      ),
      "provider credential failure was not actionable",
    );
    run("click", '.rm-ui-dialog button[aria-label="Close"]');
    openVllmDialog();
    run("fill", "#connection-name", endpointName);
    run("fill", "#connection-url", "http://127.0.0.1:9/v1");
    run(
      "eval",
      `(() => { const summary = document.querySelector(".rm-ui-dialog .rm-advanced-settings summary"); if (!summary) return false; summary.click(); return true; })()`,
    );
    setTextareaValue("#connection-models", "browser-allowed-model");
    assertProviderFormValues();
    run("click", '.rm-ui-dialog button[type="submit"]');
    run(
      "wait",
      "--fn",
      `!document.querySelector(".rm-ui-dialog") && Boolean([...document.querySelectorAll("${cardSelector}")].find((card) => card.textContent?.includes(${endpointNameLiteral})))`,
    );
  }

  run(
    "eval",
    `(() => { const card = [...document.querySelectorAll("${cardSelector}")].find((item) => item.textContent?.includes(${endpointNameLiteral})); const button = [...(card?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.includes("Refresh models")); if (!button) return false; button.focus(); return true; })()`,
  );
  run("press", "Enter");
  run("wait", "--fn", `document.body.innerText.includes("Models synced")`);
  run(
    "eval",
    `(() => { const card = [...document.querySelectorAll("${cardSelector}")].find((item) => item.textContent?.includes(${endpointNameLiteral})); const button = [...(card?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.includes("Verify")); if (!button) return false; button.focus(); return true; })()`,
  );
  run("press", "Enter");
  run(
    "wait",
    "--fn",
    `Boolean([...document.querySelectorAll("${cardSelector}")].find((card) => card.textContent?.includes(${endpointNameLiteral}))?.querySelector(".rm-connection-result"))`,
  );
  const diagnostics = JSON.parse(
    evaluate(`JSON.stringify((() => {
    const card = [...document.querySelectorAll("${cardSelector}")].find((item) => item.textContent?.includes(${endpointNameLiteral}));
    return { text: card?.textContent, diagnosticClass: card?.querySelector(".rm-connection-result")?.className, secretVisible: document.body.innerText.includes(${JSON.stringify(secretSentinel)}) };
  })())`),
  );
  assert(
    diagnostics.diagnosticClass.includes("error") &&
      diagnostics.text.includes("no discoverable models") &&
      diagnostics.text.includes("could not be verified"),
    "provider diagnostic failure was not explained",
  );
  assert(
    !diagnostics.secretVisible,
    "provider diagnostics exposed the submitted credential",
  );

  function setTextareaValue(selector, value) {
    const updated = run(
      "eval",
      `(() => {
        const control = document.querySelector(${JSON.stringify(selector)});
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        if (!(control instanceof HTMLTextAreaElement) || setter === undefined) return false;
        setter.call(control, ${JSON.stringify(value)});
        control.dispatchEvent(new InputEvent("input", { bubbles: true, data: ${JSON.stringify(value)}, inputType: "insertText" }));
        return control.value === ${JSON.stringify(value)};
      })()`,
    );
    assert(updated === "true", `could not update ${selector}`);
  }

  function assertProviderFormValues(expected = {}) {
    const submitted = JSON.parse(
      evaluate(
        `JSON.stringify(Object.fromEntries(new FormData(document.querySelector(".rm-ui-dialog form"))))`,
      ),
    );
    assert(
      submitted.modelIds === "browser-allowed-model" &&
        (expected.apiKey === undefined || submitted.apiKey === expected.apiKey),
      `provider form values were not ready: ${JSON.stringify(submitted)}`,
    );
  }
}

function evaluate(script) {
  const output = run("eval", script);
  return JSON.parse(output);
}

// The composer's secondary actions live behind the "+" dropdown, so they are
// portalled `[role=menuitem]` nodes identified by their visible text (no
// aria-label) and only mounted while the menu is open.
function clickComposerMenuItem(label, triggerLabel = "More actions") {
  const lookup = `[...document.querySelectorAll('.rm-ui-menu [role="menuitem"]')].find((item) => item.textContent?.trim() === ${JSON.stringify(label)})`;
  run("click", `button[aria-label=${JSON.stringify(triggerLabel)}]`);
  run("wait", ".rm-ui-menu");
  run(
    "wait",
    "--fn",
    `(() => { const item = ${lookup}; return Boolean(item) && item.getAttribute("aria-disabled") !== "true"; })()`,
  );
  assert(
    evaluate(
      `Boolean((() => { const item = ${lookup}; item?.click(); return item; })())`,
    ),
    `composer menu action was unavailable: ${label}`,
  );
  run("wait", "--fn", `!document.querySelector(".rm-ui-menu")`);
}

function axeViolationsForCurrentPage() {
  return JSON.parse(
    evaluate(`(async () => {
    if (!window.axe) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/node_modules/axe-core/axe.min.js";
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
    }
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    });
    return JSON.stringify(result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
      targets: violation.nodes.slice(0, 3).map((node) => node.target),
    })));
  })()`),
  );
}

function run(...args) {
  return runFor(session, ...args);
}

function runFor(targetSession, ...args) {
  const options = typeof args.at(-1) === "object" ? args.pop() : {};
  const result = spawnSync(
    "agent-browser",
    ["--session", targetSession, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_BROWSER_CONTENT_BOUNDARIES: "1",
        AGENT_BROWSER_DEFAULT_TIMEOUT: String(options.timeoutMs ?? 30_000),
      },
    },
  );
  if (result.status !== 0 && options.allowFailure !== true) {
    throw new Error(
      `agent-browser ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("--- AGENT_BROWSER_PAGE_CONTENT") &&
        !line.startsWith("--- END_AGENT_BROWSER_PAGE_CONTENT"),
    )
    .join("\n")
    .trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
