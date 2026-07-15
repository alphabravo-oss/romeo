const fixtureSchemaVersion = "romeo.scale-fixtures.v1";

export const scaleTierDefaults = {
  local: {
    chats: 3,
    knowledgeSources: 2,
    runs: 3,
    comments: 3,
    attachments: 1,
    webhookEvents: 1,
    connectorSyncs: 1,
    toolDispatches: 1,
    adminListRepeats: 1,
  },
  small: {
    chats: 10,
    knowledgeSources: 5,
    runs: 10,
    comments: 10,
    attachments: 2,
    webhookEvents: 3,
    connectorSyncs: 3,
    toolDispatches: 3,
    adminListRepeats: 3,
  },
  enterprise: {
    chats: 50,
    knowledgeSources: 25,
    runs: 75,
    comments: 75,
    attachments: 10,
    webhookEvents: 15,
    connectorSyncs: 15,
    toolDispatches: 15,
    adminListRepeats: 10,
  },
};

const forbiddenValuePatterns = [
  /postgres(?:ql)?:\/\//iu,
  /bearer\s+[A-Za-z0-9._-]+/iu,
  /sk-[A-Za-z0-9_-]+/u,
  /BEGIN [A-Z ]*PRIVATE KEY/u,
  /\b(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)\b/iu,
];

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

export function generateScaleFixtures(options = {}) {
  const tier = options.tier ?? "local";
  if (!Object.hasOwn(scaleTierDefaults, tier)) {
    throw new Error(
      `Unknown scale tier ${tier}; expected ${Object.keys(scaleTierDefaults).join(", ")}.`,
    );
  }
  const countInput = { ...scaleTierDefaults[tier] };
  for (const key of Object.keys(countInput)) {
    if (options[key] !== undefined) countInput[key] = options[key];
  }
  const counts = normalizeCounts(countInput);
  const random = seededRandom(options.seed ?? `${tier}-scale-fixtures-v1`);
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const chats = range(counts.chats).map((index) => ({
    id: fixtureId("chat", index),
    workspaceId: "workspace_default",
    title: `Scale fixture chat ${index + 1}`,
  }));

  const knowledgeSources = range(counts.knowledgeSources).map((index) => ({
    id: fixtureId("source", index),
    knowledgeBaseId: "kb_default",
    fileName: `scale-fixture-${index + 1}.txt`,
    mimeType: "text/plain",
    sizeBytes: 320 + Math.floor(random() * 120),
    content: [
      `Synthetic Romeo scale document ${index + 1}.`,
      "It exercises retrieval, listing, audit, notification, and workflow read paths.",
      `Marker ${fixtureId("marker", index)} is safe generated test data.`,
    ].join(" "),
  }));

  const runs = range(counts.runs).map((index) => ({
    id: fixtureId("run", index),
    chatFixtureId: chats[index % chats.length]?.id,
    agentId: "agent_default",
    content: `Synthetic scale request ${index + 1} asks for a short summary of marker ${fixtureId("marker", index)}.`,
  }));

  const comments = range(counts.comments).map((index) => ({
    id: fixtureId("comment", index),
    chatFixtureId: chats[index % chats.length]?.id,
    body: `Please review @user_dev_admin synthetic scale case ${index + 1}.`,
  }));

  const attachments = range(counts.attachments).map((index) => ({
    id: fixtureId("attachment", index),
    chatFixtureId: chats[index % chats.length]?.id,
    agentId: "agent_default",
    fileName: `scale-fixture-${index + 1}.png`,
    mimeType: "image/png",
    sizeBytes: Buffer.from(tinyPngBase64, "base64").byteLength,
    dataBase64: tinyPngBase64,
    content: `Synthetic attachment upload ${index + 1}.`,
  }));

  const webhookEvents = range(counts.webhookEvents).map((index) => ({
    id: fixtureId("webhook", index),
    eventType: "scale.test",
    payload: {
      fixtureId: fixtureId("webhook", index),
      sequence: index + 1,
      category: "synthetic-scale",
    },
  }));

  const connectorSyncs = range(counts.connectorSyncs).map((index) => ({
    id: fixtureId("connector", index),
    type: "local_import",
    workspaceId: "workspace_default",
    knowledgeBaseId: "kb_default",
    name: `Scale local import connector ${index + 1}`,
    config: { sourceAccessMode: "knowledge_base" },
    items: [
      {
        fileName: `scale-connector-${index + 1}.txt`,
        mimeType: "text/plain",
        sizeBytes: 260 + Math.floor(random() * 80),
        content: [
          `Synthetic connector sync document ${index + 1}.`,
          `Marker ${fixtureId("connector_marker", index)} exercises the local-import connector path.`,
        ].join(" "),
      },
    ],
  }));

  const toolDispatches = range(counts.toolDispatches).map((index) => ({
    id: fixtureId("tool_dispatch", index),
    name: `Scale tool dispatch connector ${index + 1}`,
    allowedHost: "scale-tools.example.invalid",
    serverUrl: "https://scale-tools.example.invalid",
    operationId: `scaleToolDispatch${index + 1}`,
    path: `/v1/scale/{fixtureId}`,
    method: "post",
    parameters: {
      fixtureId: fixtureId("tool_dispatch", index),
    },
    body: {
      fixtureId: fixtureId("tool_dispatch", index),
      sequence: index + 1,
    },
    requestKeyNames: ["fixtureId", "sequence"],
    executionMode: "dispatch-request-queue",
  }));

  const adminListReads = range(counts.adminListRepeats).flatMap(() => [
    "/api/v1/chats?workspaceId=workspace_default",
    "/api/v1/knowledge-bases/kb_default/sources",
    "/api/v1/usage/events",
    "/api/v1/audit-logs",
    "/api/v1/notifications",
    "/api/v1/notification-deliveries",
  ]);

  const fixtures = {
    schemaVersion: fixtureSchemaVersion,
    generatedAt,
    tier,
    seed: options.seed ?? `${tier}-scale-fixtures-v1`,
    classification: {
      dataOrigin: "generated",
      customerData: false,
      productionCredentials: false,
      rawProviderPayloads: false,
    },
    counts,
    chats,
    knowledgeSources,
    runs,
    comments,
    attachments,
    webhookEvents,
    connectorSyncs,
    toolDispatches,
    adminListReads,
  };
  validateScaleFixtures(fixtures);
  return fixtures;
}

export function validateScaleFixtures(fixtures) {
  if (fixtures?.schemaVersion !== fixtureSchemaVersion) {
    throw new Error("Scale fixture schema version is invalid.");
  }
  for (const key of [
    "chats",
    "knowledgeSources",
    "runs",
    "comments",
    "attachments",
    "webhookEvents",
    "connectorSyncs",
    "toolDispatches",
    "adminListReads",
  ]) {
    if (!Array.isArray(fixtures[key])) {
      throw new Error(`Scale fixtures missing array ${key}.`);
    }
  }

  for (const [path, value] of leafStrings(fixtures)) {
    for (const pattern of forbiddenValuePatterns) {
      if (pattern.test(value)) {
        throw new Error(`Scale fixture value ${path} matched ${pattern}.`);
      }
    }
  }

  const chatIds = new Set(fixtures.chats.map((chat) => chat.id));
  for (const item of [
    ...fixtures.runs,
    ...fixtures.comments,
    ...fixtures.attachments,
  ]) {
    if (!chatIds.has(item.chatFixtureId)) {
      throw new Error(`Scale fixture ${item.id} references an unknown chat.`);
    }
  }
  for (const sync of fixtures.connectorSyncs) {
    if (sync.type !== "local_import") {
      throw new Error(
        `Scale connector fixture ${sync.id} must use local_import.`,
      );
    }
    if (!Array.isArray(sync.items) || sync.items.length === 0) {
      throw new Error(`Scale connector fixture ${sync.id} is missing items.`);
    }
  }
  for (const dispatch of fixtures.toolDispatches) {
    if (dispatch.allowedHost !== new URL(dispatch.serverUrl).hostname) {
      throw new Error(
        `Scale tool dispatch fixture ${dispatch.id} host mismatch.`,
      );
    }
    if (dispatch.executionMode !== "dispatch-request-queue") {
      throw new Error(
        `Scale tool dispatch fixture ${dispatch.id} must queue dispatch requests.`,
      );
    }
  }
  return true;
}

export function summarizeScaleFixtures(fixtures) {
  validateScaleFixtures(fixtures);
  return {
    schemaVersion: "romeo.scale-fixture-report.v1",
    generatedAt: new Date().toISOString(),
    fixtureSchemaVersion: fixtures.schemaVersion,
    tier: fixtures.tier,
    counts: fixtures.counts,
    checks: [
      "synthetic_fixture_schema",
      "secret_value_patterns_absent",
      "chat_references_valid",
      "load_operation_inventory_present",
    ],
    operationInventory: {
      chatWrites: fixtures.chats.length,
      knowledgeSourceWrites: fixtures.knowledgeSources.length,
      runWrites: fixtures.runs.length,
      commentWrites: fixtures.comments.length,
      attachmentWrites: fixtures.attachments.length,
      webhookEvents: fixtures.webhookEvents.length,
      connectorSyncs: fixtures.connectorSyncs.length,
      toolDispatchRequests: fixtures.toolDispatches.length,
      adminListReads: fixtures.adminListReads.length,
    },
  };
}

function normalizeCounts(input) {
  const counts = {};
  for (const key of [
    "chats",
    "knowledgeSources",
    "runs",
    "comments",
    "attachments",
    "webhookEvents",
    "connectorSyncs",
    "toolDispatches",
    "adminListRepeats",
  ]) {
    const value = Number.parseInt(String(input[key] ?? 0), 10);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${key} must be a non-negative integer.`);
    }
    counts[key] = value;
  }
  if (counts.chats < 1) throw new Error("chats must be at least 1.");
  return counts;
}

function fixtureId(kind, index) {
  return `scale_${kind}_${String(index + 1).padStart(4, "0")}`;
}

function range(length) {
  return Array.from({ length }, (_, index) => index);
}

function seededRandom(seed) {
  let state = 0;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(31, state) + seed.charCodeAt(index);
    state >>>= 0;
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function* leafStrings(value, path = "$") {
  if (typeof value === "string") {
    yield [path, value];
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      yield* leafStrings(item, `${path}[${index}]`);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      yield* leafStrings(item, `${path}.${key}`);
    }
  }
}
