#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const manifestUrl = new URL(
  "../test/fixtures/enterprise-ai-fixtures.json",
  import.meta.url,
);
const expectedSections = [
  "models",
  "media",
  "acl",
  "streaming",
  "dlp",
  "compute",
];
const terminalEventTypes = new Set([
  "run.cancelled",
  "run.completed",
  "run.failed",
]);
const allowedDetectors = new Set([
  "api_token",
  "credit_card",
  "email_address",
  "us_ssn",
]);
const mediaSignatures = new Map([
  ["image/png", "89504e470d0a1a0a"],
  ["audio/wav", "52494646"],
  ["application/pdf", "25504446"],
]);

const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
validateManifest(manifest);
runAdversarialSelfTests(manifest);

console.log(
  `Enterprise fixture policy passed: ${manifest.models.length} models, ${manifest.media.length} media, ${manifest.acl.cases.length} ACL cases, ${manifest.streaming.length} streams, ${manifest.dlp.length} DLP cases, ${manifest.compute.length} compute cases.`,
);

function validateManifest(value) {
  assertObject(value, "manifest");
  assert(value.schemaVersion === 1, "schemaVersion must be 1");
  assert(
    value.classification === "synthetic_non_secret",
    "classification must be synthetic_non_secret",
  );
  for (const section of expectedSections)
    assert(value[section] !== undefined, `missing ${section} section`);
  validateModels(value.models);
  validateMedia(value.media);
  validateAcl(value.acl);
  validateStreaming(value.streaming);
  validateDlp(value.dlp);
  validateCompute(value.compute);
  validatePrivacy(value);
  validateUniqueIds(value);
}

function validateModels(models) {
  assertArray(models, "models");
  assert(models.length >= 2, "model corpus must include at least two models");
  let hasReasoning = false;
  let hasMultimodal = false;
  for (const model of models) {
    assertFixtureId(model.id, "model id");
    assertFixtureId(model.providerId, "provider id");
    assertString(model.name, "model name");
    assertArray(model.modalities, `${model.id} modalities`);
    assert(model.modalities.includes("text"), `${model.id} must support text`);
    assert(
      Number.isInteger(model.contextWindow) &&
        model.contextWindow >= 1024 &&
        model.contextWindow <= 10_000_000,
      `${model.id} contextWindow is outside fixture bounds`,
    );
    hasReasoning ||= model.reasoning === true;
    hasMultimodal ||= model.modalities.some((item) => item !== "text");
  }
  assert(hasReasoning, "model corpus must include reasoning support");
  assert(hasMultimodal, "model corpus must include multimodal support");
}

function validateMedia(media) {
  assertArray(media, "media");
  assert(
    new Set(media.map((item) => item.kind)).size >= 3,
    "media corpus must include image, audio, and document kinds",
  );
  for (const item of media) {
    assertFixtureId(item.id, "media id");
    assertString(item.fileName, `${item.id} fileName`);
    const expectedSignature = mediaSignatures.get(item.mimeType);
    assert(
      expectedSignature !== undefined,
      `${item.id} MIME is not allowlisted`,
    );
    const bytes = Buffer.from(item.payloadBase64, "base64");
    assert(bytes.length > 0, `${item.id} payload is empty`);
    assert(bytes.length <= 1_048_576, `${item.id} exceeds 1 MiB`);
    assert(bytes.length === item.sizeBytes, `${item.id} size does not match`);
    assert(
      bytes.subarray(0, expectedSignature.length / 2).toString("hex") ===
        expectedSignature,
      `${item.id} signature does not match MIME`,
    );
    assert(
      createHash("sha256").update(bytes).digest("hex") === item.sha256,
      `${item.id} checksum does not match payload`,
    );
  }
}

function validateAcl(acl) {
  assertObject(acl, "acl");
  assertArray(acl.resources, "acl.resources");
  assertArray(acl.grants, "acl.grants");
  assertArray(acl.cases, "acl.cases");
  const resource = acl.resources[0];
  assert(resource !== undefined, "ACL corpus requires a resource");
  for (const key of ["id", "orgId", "workspaceId"])
    assertFixtureId(resource[key], `ACL resource ${key}`);
  for (const grant of acl.grants) {
    assertFixtureId(grant.id, "grant id");
    assert(
      ["agent", "chat", "knowledge_base", "model", "provider", "tool"].includes(
        grant.resourceType,
      ),
      `${grant.id} resourceType is not supported`,
    );
    assert(
      ["group", "service_account", "user"].includes(grant.principalType),
      `${grant.id} principalType is not supported`,
    );
    assert(
      ["read", "run", "use", "write"].includes(grant.permission),
      `${grant.id} permission is not supported`,
    );
    assert(
      grant.resourceId === resource.id,
      `${grant.id} must target the fixture resource`,
    );
  }
  const expectedKinds = new Map([
    ["direct_read_allowed", true],
    ["group_run_allowed", true],
    ["missing_write_denied", false],
    ["cross_org_denied", false],
    ["cross_workspace_denied", false],
  ]);
  for (const [suffix, expected] of expectedKinds) {
    const testCase = acl.cases.find((item) => item.id.endsWith(suffix));
    assert(testCase !== undefined, `ACL corpus is missing ${suffix}`);
    assert(
      testCase.expectedAllowed === expected,
      `${testCase.id} has the wrong expected decision`,
    );
    assert(
      ["read", "run", "use", "write"].includes(testCase.permission),
      `${testCase.id} permission is not supported`,
    );
  }
}

function validateStreaming(streams) {
  assertArray(streams, "streaming");
  assert(streams.length > 0, "streaming corpus is empty");
  for (const stream of streams) {
    assertFixtureId(stream.id, "stream id");
    assertFixtureId(stream.runId, "stream run id");
    assertArray(stream.events, `${stream.id} events`);
    stream.events.forEach((event, index) => {
      assertFixtureId(event.id, "event id");
      assert(
        event.sequence === index + 1,
        `${stream.id} sequences must be contiguous from one`,
      );
      assertString(event.type, `${stream.id} event type`);
      assertObject(event.data, `${stream.id} event data`);
    });
    assert(
      stream.events.filter((event) => terminalEventTypes.has(event.type))
        .length === 1,
      `${stream.id} must contain exactly one terminal event`,
    );
    assert(
      terminalEventTypes.has(stream.events.at(-1)?.type),
      `${stream.id} terminal event must be last`,
    );
    const replay = stream.events
      .filter((event) => event.sequence > stream.resumeAfterSequence)
      .map((event) => event.sequence);
    assert(
      JSON.stringify(replay) === JSON.stringify(stream.expectedReplaySequences),
      `${stream.id} replay expectation is stale`,
    );
  }
}

function validateDlp(cases) {
  assertArray(cases, "dlp");
  assert(
    new Set(cases.map((item) => item.detector)).size === allowedDetectors.size,
    "DLP corpus must cover every detector",
  );
  for (const item of cases) {
    assertFixtureId(item.id, "DLP case id");
    assert(
      allowedDetectors.has(item.detector),
      `${item.id} detector is unknown`,
    );
    assertArray(item.segments, `${item.id} segments`);
    assert(item.segments.length >= 2, `${item.id} must remain segmented`);
    assert(
      item.segments.every(
        (segment) => typeof segment === "string" && segment.length > 0,
      ),
      `${item.id} has an empty segment`,
    );
    assert(item.expectedCount === 1, `${item.id} expectedCount must be one`);
  }
}

function validateCompute(cases) {
  assertArray(cases, "compute");
  assert(cases.length > 0, "compute corpus is empty");
  for (const item of cases) {
    assertFixtureId(item.id, "compute id");
    assert(item.networkPolicy === "none", `${item.id} must disable network`);
    assertArray(item.sourceFragments, `${item.id} sourceFragments`);
    assert(
      item.sourceFragments.length >= 2,
      `${item.id} source must remain fragmented`,
    );
    const source = item.sourceFragments.join("");
    assert(source.length <= 4096, `${item.id} source is unbounded`);
    assert(
      !/(?:https?:\/\/|\bsocket\b|\brequests\b|\bsubprocess\b|child_process)/iu.test(
        source,
      ),
      `${item.id} source contains network or process access`,
    );
    const limits = item.limits;
    assertObject(limits, `${item.id} limits`);
    for (const [name, max] of Object.entries({
      cpuMillis: 60_000,
      memoryBytes: 1_073_741_824,
      wallTimeMillis: 120_000,
      outputBytes: 1_048_576,
      artifactBytes: 10_485_760,
    })) {
      assert(
        Number.isInteger(limits[name]) &&
          limits[name] >= 0 &&
          limits[name] <= max,
        `${item.id} ${name} is outside fixture bounds`,
      );
    }
    assert(
      /^[a-f0-9]{64}$/u.test(item.expected.stdoutSha256),
      `${item.id} expected output digest is invalid`,
    );
  }
}

function validatePrivacy(value) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /\bAKIA[0-9A-Z]{16}\b/u,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
    /\bsk-[A-Za-z0-9_-]{16,}\b/u,
    /\b(?:https?:\/\/)(?!example\.(?:invalid|test)\b)/iu,
  ];
  for (const pattern of forbidden)
    assert(!pattern.test(serialized), `fixture privacy violation: ${pattern}`);
}

function validateUniqueIds(value) {
  const ids = [];
  collectIds(value, ids);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert(
    duplicates.length === 0,
    `duplicate fixture IDs: ${duplicates.join(", ")}`,
  );
}

function collectIds(value, ids) {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, ids);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (typeof value.id === "string") ids.push(value.id);
  for (const item of Object.values(value)) collectIds(item, ids);
}

function runAdversarialSelfTests(source) {
  const cases = [
    {
      name: "usable secret",
      mutate(value) {
        value.models[0].name = "sk-thisisnotallowed000000000000";
      },
    },
    {
      name: "media checksum drift",
      mutate(value) {
        value.media[0].sha256 = "0".repeat(64);
      },
    },
    {
      name: "missing cross-tenant ACL",
      mutate(value) {
        value.acl.cases = value.acl.cases.filter(
          (item) => !item.id.endsWith("cross_org_denied"),
        );
      },
    },
    {
      name: "non-contiguous stream",
      mutate(value) {
        value.streaming[0].events[1].sequence = 9;
      },
    },
    {
      name: "networked compute",
      mutate(value) {
        value.compute[0].networkPolicy = "internet";
      },
    },
  ];
  for (const testCase of cases) {
    const candidate = structuredClone(source);
    testCase.mutate(candidate);
    let rejected = false;
    try {
      validateManifest(candidate);
    } catch {
      rejected = true;
    }
    assert(rejected, `adversarial self-test did not reject ${testCase.name}`);
  }
}

function assertFixtureId(value, label) {
  assert(
    typeof value === "string" && /^fx_[a-z0-9_]+$/u.test(value),
    `${label} must be an fx_ identifier`,
  );
}

function assertArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
}

function assertObject(value, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
}

function assertString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} is required`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
