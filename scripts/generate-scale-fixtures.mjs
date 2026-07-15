import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  generateScaleFixtures,
  scaleTierDefaults,
  summarizeScaleFixtures,
} from "./lib/scale-fixtures.mjs";

const outputPath = argValue("--output");
const reportPath = argValue("--report-output");
const tier = argValue("--tier") ?? "local";
const seed = argValue("--seed");

if (!Object.hasOwn(scaleTierDefaults, tier)) {
  throw new Error(
    `--tier must be one of ${Object.keys(scaleTierDefaults).join(", ")}.`,
  );
}

const fixtures = generateScaleFixtures({
  tier,
  seed,
  chats: optionalInteger("--chats"),
  knowledgeSources: optionalInteger("--knowledge-sources"),
  runs: optionalInteger("--runs"),
  comments: optionalInteger("--comments"),
  attachments: optionalInteger("--attachments"),
  webhookEvents: optionalInteger("--webhook-events"),
  connectorSyncs: optionalInteger("--connector-syncs"),
  toolDispatches: optionalInteger("--tool-dispatches"),
  adminListRepeats: optionalInteger("--admin-list-repeats"),
});
const serialized = `${JSON.stringify(fixtures, null, 2)}\n`;

if (outputPath === undefined) process.stdout.write(serialized);
else writeJsonFile(outputPath, serialized);

if (reportPath !== undefined) {
  writeJsonFile(
    reportPath,
    `${JSON.stringify(summarizeScaleFixtures(fixtures), null, 2)}\n`,
  );
}

function writeJsonFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function optionalInteger(name) {
  const value = argValue(name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
