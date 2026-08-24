import {
  argValue,
  argValues,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const output = argValue("--output") ?? "dist/ci/container-image-manifest.json";
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const images = argValues("--image").map(parseImage);
const byRole = new Map(images.map((image) => [image.role, image]));

if (byRole.size !== images.length)
  throw new Error("Container image manifest roles must be unique.");
for (const role of ["app", "ops"])
  if (!byRole.has(role))
    throw new Error(`Container image manifest requires ${role}.`);

writeJsonOrStdout({
  path: output,
  stdout: process.argv.includes("--stdout"),
  value: {
    schemaVersion: "romeo.container-image-manifest.v1",
    generatedAt,
    images: [...byRole.values()].sort((left, right) =>
      left.role.localeCompare(right.role),
    ),
  },
});

function parseImage(value) {
  const match = /^(app|ops)=([^@\s]+)@(sha256:[a-f0-9]{64})$/u.exec(value);
  if (match === null)
    throw new Error(
      "--image must use role=repository:tag@sha256:<64 lowercase hex>.",
    );
  return { role: match[1], reference: match[2], digest: match[3] };
}
