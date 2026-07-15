import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export function loadGaTargetEnvFile(path) {
  if (path === undefined || path === "") {
    return {
      env: {},
      evidence: envFileEvidence({ configured: false }),
    };
  }

  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    throw new Error(
      `GA target env file not found at ${safeEvidencePath(path)}.`,
    );
  }

  const parsed = parseEnvFile(readFileSync(resolved, "utf8"));
  return {
    env: parsed.env,
    evidence: envFileEvidence({
      configured: true,
      path,
      ...parsed.summary,
    }),
  };
}

export function withGaTargetProcessEnv(env, callback) {
  const entries = Object.entries(isRecord(env) ? env : {});
  if (entries.length === 0) return callback();

  const previous = new Map();
  for (const [name, value] of entries) {
    previous.set(
      name,
      Object.hasOwn(process.env, name) ? process.env[name] : undefined,
    );
    process.env[name] = value;
  }

  try {
    return callback();
  } finally {
    for (const [name, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

function parseEnvFile(source) {
  const env = {};
  const names = [];
  const invalidLines = [];
  const duplicateNames = new Set();
  let commentOrBlankLineCount = 0;
  let blankVariableCount = 0;

  const lines = source.split(/\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index].replace(/\r$/u, "");
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      commentOrBlankLineCount += 1;
      continue;
    }

    const assignment = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trimStart()
      : trimmed;
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex <= 0) {
      invalidLines.push(lineNumber);
      continue;
    }

    const name = assignment.slice(0, separatorIndex).trim();
    const rawValue = assignment.slice(separatorIndex + 1).trim();
    if (!isEnvName(name)) {
      invalidLines.push(lineNumber);
      continue;
    }

    const parsedValue = parseEnvValue(rawValue);
    if (parsedValue.invalid) {
      invalidLines.push(lineNumber);
      continue;
    }

    names.push(name);
    if (parsedValue.value === "") {
      blankVariableCount += 1;
      continue;
    }

    if (Object.hasOwn(env, name)) duplicateNames.add(name);
    env[name] = parsedValue.value;
  }

  if (invalidLines.length > 0) {
    throw new Error(
      `GA target env file contains invalid assignment lines: ${invalidLines.join(", ")}.`,
    );
  }

  const variableNames = uniqueSorted(names);
  return {
    env,
    summary: {
      variableCount: variableNames.length,
      populatedVariableCount: Object.keys(env).length,
      blankVariableCount,
      duplicateCount: duplicateNames.size,
      commentOrBlankLineCount,
      appliedVariableCount: Object.keys(env).length,
      variableNames,
      warningCodes:
        duplicateNames.size > 0 ? ["duplicate_variables_last_value_used"] : [],
    },
  };
}

function parseEnvValue(rawValue) {
  if (rawValue === "") return { value: "" };
  const quote = rawValue[0];
  if (quote === "'" || quote === '"') {
    if (rawValue.length < 2 || rawValue[rawValue.length - 1] !== quote) {
      return { invalid: true };
    }
    return { value: rawValue.slice(1, -1) };
  }
  return { value: rawValue };
}

function envFileEvidence(input) {
  return {
    configured: input.configured === true,
    loaded: input.configured === true,
    path:
      input.configured === true
        ? safeEvidencePath(input.path)
        : "not_configured",
    variableCount: safeCount(input.variableCount),
    populatedVariableCount: safeCount(input.populatedVariableCount),
    blankVariableCount: safeCount(input.blankVariableCount),
    duplicateCount: safeCount(input.duplicateCount),
    commentOrBlankLineCount: safeCount(input.commentOrBlankLineCount),
    appliedVariableCount: safeCount(input.appliedVariableCount),
    variableNames: uniqueSorted(asArray(input.variableNames).filter(isEnvName)),
    warningCodes: uniqueSorted(asArray(input.warningCodes).filter(isSafeToken)),
    rawValuesReturned: false,
    rawFileBodyReturned: false,
    shellSourced: false,
    blankValuesApplied: false,
  };
}

function safeEvidencePath(input) {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (isAbsolute(input) || input.includes("..") || input.includes("\\")) {
    return "redacted_path";
  }
  return safeString(input, "redacted_path", 240);
}

function safeString(input, fallback, maxLength = 160) {
  if (typeof input !== "string" || input.length === 0) return fallback;
  const pattern = new RegExp(`^[A-Za-z0-9 _./:@,()'\\-]{1,${maxLength}}$`, "u");
  if (!pattern.test(input)) return fallback;
  return input;
}

function isEnvName(input) {
  return (
    typeof input === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(input)
  );
}

function isSafeToken(input) {
  return typeof input === "string" && /^[A-Za-z0-9_.:-]{1,180}$/u.test(input);
}

function safeCount(input) {
  return Number.isInteger(input) && input >= 0 ? input : 0;
}

function uniqueSorted(input) {
  return [...new Set(input)].sort((left, right) => left.localeCompare(right));
}

function asArray(input) {
  return Array.isArray(input) ? input : [];
}

function isRecord(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
