import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

import {
  emptyBundleCheckSummary,
  emptyBundleInventory,
  emptyBundleRequirements,
  emptyPreflightSummary,
  emptySummary,
  emptyTargetExecutionEnvFile,
  emptyTargetExecutionRun,
  emptyTargetExecutionSummary,
  emptyTargetPlanSummary,
} from "./ga-evidence-defaults";
import {
  sanitizeGate,
  sanitizePreflightChecklist,
  sanitizePreflightSummary,
  sanitizeSummary,
  sanitizeTarget,
  sanitizeTargetPreflightGate,
} from "./ga-evidence-checklist-sanitizers";
import {
  redactionPosture,
  safeBundleRedaction,
  safeTargetExecutionStatus,
  sanitizeBundleGa,
  sanitizeBundleInventory,
  sanitizeBundleRelease,
  sanitizeBundleRequirements,
  sanitizeTargetExecutionEnvFile,
  sanitizeTargetExecutionGate,
  sanitizeTargetExecutionRun,
  sanitizeTargetExecutionSource,
  sanitizeTargetExecutionSummary,
  summarizeBundleChecks,
} from "./ga-evidence-execution-sanitizers";
import {
  buildLiveGateReadiness,
  invalidBundle,
  invalidTargetExecution,
  invalidTargetPlan,
  invalidTargetPreflight,
} from "./ga-evidence-readiness";
import { asArray, isRecord, safeToken } from "./ga-evidence-sanitize-support";
import {
  sanitizeTargetPlanGate,
  sanitizeTargetPlanPhase,
  sanitizeTargetPlanSource,
  sanitizeTargetPlanSummary,
} from "./ga-evidence-plan-sanitizers";
import type { GaEvidencePostureReport } from "./ga-evidence-types";

export * from "./ga-evidence-status";
export * from "./ga-evidence-types";

export class GaEvidencePostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<GaEvidencePostureReport> {
    assertScope(subject, "admin:read");

    const configuredPath = this.env.GA_CHECKLIST_PATH.trim();
    if (configuredPath.length === 0) {
      return this.notConfigured(subject);
    }

    let raw: string;
    try {
      raw = await readFile(configuredPath, "utf8");
    } catch {
      return this.invalid(subject, "read_failed");
    }

    let checklist: unknown;
    try {
      checklist = JSON.parse(raw);
    } catch {
      return this.invalid(subject, "invalid_json");
    }

    if (
      !isRecord(checklist) ||
      checklist.schemaVersion !== "romeo.ga-checklist.v1"
    ) {
      return this.invalid(subject, "schema_mismatch");
    }

    const gates = asArray(checklist.gates).map(sanitizeGate);
    const summary = sanitizeSummary(checklist.summary);
    const target = sanitizeTarget(checklist.target);
    const requiredLiveBlockers = gates
      .filter((gate) => gate.status === "blocked" && gate.environmentRequired)
      .map((gate) => ({
        id: gate.id,
        phase: gate.phase,
        title: gate.title,
        securityCritical: gate.securityCritical,
      }));
    const checklistStatus =
      checklist.status === "passed" || checklist.status === "blocked"
        ? checklist.status
        : "invalid";
    const targetPreflight = await this.targetPreflight();
    const targetPlan = await this.targetPlan();
    const targetExecution = await this.targetExecution();
    const bundle = await this.bundle();
    const liveGateReadiness = buildLiveGateReadiness({
      gates,
      requiredLiveBlockers,
      targetPreflight,
    });
    const warnings: GaEvidencePostureReport["warnings"] = [];
    if (checklistStatus === "blocked" || summary.blocked > 0) {
      warnings.push("ga_blocked");
    }
    if (requiredLiveBlockers.length > 0) {
      warnings.push("live_environment_evidence_required");
    }
    if (targetPreflight.status === "blocked") {
      warnings.push("ga_target_preflight_blocked");
    } else if (targetPreflight.status === "invalid") {
      warnings.push("ga_target_preflight_invalid");
    }
    if (targetPlan.status === "invalid") {
      warnings.push("ga_target_plan_invalid");
    }
    if (targetExecution.status === "invalid") {
      warnings.push("ga_target_execution_invalid");
    } else if (targetExecution.status === "failed") {
      warnings.push("ga_target_execution_failed");
    }
    if (bundle.status === "blocked") {
      warnings.push("ga_bundle_blocked");
    } else if (bundle.status === "invalid") {
      warnings.push("ga_bundle_invalid");
    }

    return {
      schema: "romeo.ga-evidence-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "passed" : "attention_required",
      checklist: {
        configured: true,
        source: "configured_file",
        status: checklistStatus,
        schemaVersion: "romeo.ga-checklist.v1",
        ...(typeof checklist.generatedAt === "string"
          ? { generatedAt: checklist.generatedAt }
          : {}),
        ...(typeof checklist.strict === "boolean"
          ? { strict: checklist.strict }
          : {}),
        ...(target === undefined ? {} : { target }),
        summary,
        exceptionCount: asArray(checklist.exceptions).length,
      },
      targetPreflight,
      targetPlan,
      targetExecution,
      bundle,
      gates,
      requiredLiveBlockers,
      liveGateReadiness,
      redaction: redactionPosture(),
      warnings,
    };
  }

  private async notConfigured(
    subject: AuthSubject,
  ): Promise<GaEvidencePostureReport> {
    return {
      schema: "romeo.ga-evidence-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: "attention_required",
      checklist: {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        summary: emptySummary,
        exceptionCount: 0,
      },
      targetPreflight: await this.targetPreflight(),
      targetPlan: await this.targetPlan(),
      targetExecution: await this.targetExecution(),
      bundle: await this.bundle(),
      gates: [],
      requiredLiveBlockers: [],
      liveGateReadiness: [],
      redaction: redactionPosture(),
      warnings: ["ga_checklist_path_not_configured"],
    };
  }

  private async invalid(
    subject: AuthSubject,
    invalidReason: NonNullable<
      GaEvidencePostureReport["checklist"]["invalidReason"]
    >,
  ): Promise<GaEvidencePostureReport> {
    return {
      schema: "romeo.ga-evidence-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: "attention_required",
      checklist: {
        configured: true,
        source: "configured_file",
        status: "invalid",
        summary: emptySummary,
        exceptionCount: 0,
        invalidReason,
      },
      targetPreflight: await this.targetPreflight(),
      targetPlan: await this.targetPlan(),
      targetExecution: await this.targetExecution(),
      bundle: await this.bundle(),
      gates: [],
      requiredLiveBlockers: [],
      liveGateReadiness: [],
      redaction: redactionPosture(),
      warnings: ["ga_checklist_invalid"],
    };
  }

  private async targetPreflight(): Promise<
    GaEvidencePostureReport["targetPreflight"]
  > {
    const configuredPath = this.env.GA_TARGET_PREFLIGHT_PATH.trim();
    if (configuredPath.length === 0) {
      return {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        summary: emptyPreflightSummary,
        gates: [],
      };
    }

    let raw: string;
    try {
      raw = await readFile(configuredPath, "utf8");
    } catch {
      return invalidTargetPreflight("read_failed");
    }

    let preflight: unknown;
    try {
      preflight = JSON.parse(raw);
    } catch {
      return invalidTargetPreflight("invalid_json");
    }

    if (
      !isRecord(preflight) ||
      preflight.schemaVersion !== "romeo.ga-target-preflight.v1"
    ) {
      return invalidTargetPreflight("schema_mismatch");
    }

    const status =
      preflight.status === "ready" || preflight.status === "blocked"
        ? preflight.status
        : "invalid";

    return {
      configured: true,
      source: "configured_file",
      status,
      schemaVersion: "romeo.ga-target-preflight.v1",
      ...(typeof preflight.generatedAt === "string"
        ? { generatedAt: preflight.generatedAt }
        : {}),
      checklist: sanitizePreflightChecklist(preflight.checklist),
      summary: sanitizePreflightSummary(preflight.summary),
      gates: asArray(preflight.gates).map(sanitizeTargetPreflightGate),
    };
  }

  private async targetPlan(): Promise<GaEvidencePostureReport["targetPlan"]> {
    const configuredPath = this.env.GA_TARGET_PLAN_PATH.trim();
    if (configuredPath.length === 0) {
      return {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        summary: emptyTargetPlanSummary,
        phases: [],
        gates: [],
      };
    }

    let raw: string;
    try {
      raw = await readFile(configuredPath, "utf8");
    } catch {
      return invalidTargetPlan("read_failed");
    }

    let plan: unknown;
    try {
      plan = JSON.parse(raw);
    } catch {
      return invalidTargetPlan("invalid_json");
    }

    if (
      !isRecord(plan) ||
      plan.schemaVersion !== "romeo.ga-target-evidence-plan.v1"
    ) {
      return invalidTargetPlan("schema_mismatch");
    }

    const status =
      plan.status === "ready" || plan.status === "blocked"
        ? plan.status
        : "invalid";

    return {
      configured: true,
      source: "configured_file",
      status,
      schemaVersion: "romeo.ga-target-evidence-plan.v1",
      ...(typeof plan.generatedAt === "string"
        ? { generatedAt: plan.generatedAt }
        : {}),
      sourcePreflight: sanitizeTargetPlanSource(plan.source),
      summary: sanitizeTargetPlanSummary(plan.summary),
      phases: asArray(plan.phases).map(sanitizeTargetPlanPhase),
      gates: asArray(plan.gates).map(sanitizeTargetPlanGate),
    };
  }

  private async targetExecution(): Promise<
    GaEvidencePostureReport["targetExecution"]
  > {
    const configuredPath = this.env.GA_TARGET_EXECUTION_PATH.trim();
    if (configuredPath.length === 0) {
      return {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        execution: emptyTargetExecutionRun,
        envFile: emptyTargetExecutionEnvFile,
        summary: emptyTargetExecutionSummary,
        gates: [],
      };
    }

    let raw: string;
    try {
      raw = await readFile(configuredPath, "utf8");
    } catch {
      return invalidTargetExecution("read_failed");
    }

    let execution: unknown;
    try {
      execution = JSON.parse(raw);
    } catch {
      return invalidTargetExecution("invalid_json");
    }

    if (
      !isRecord(execution) ||
      execution.schemaVersion !== "romeo.ga-target-execution.v1"
    ) {
      return invalidTargetExecution("schema_mismatch");
    }

    const status = safeTargetExecutionStatus(execution.status);

    return {
      configured: true,
      source: "configured_file",
      status,
      schemaVersion: "romeo.ga-target-execution.v1",
      ...(typeof execution.generatedAt === "string"
        ? { generatedAt: execution.generatedAt }
        : {}),
      sourcePlan: sanitizeTargetExecutionSource(execution.source),
      execution: sanitizeTargetExecutionRun(execution.execution),
      envFile: sanitizeTargetExecutionEnvFile(execution.envFile),
      summary: sanitizeTargetExecutionSummary(execution.summary),
      gates: asArray(execution.gates).map(sanitizeTargetExecutionGate),
    };
  }

  private async bundle(): Promise<GaEvidencePostureReport["bundle"]> {
    const configuredPath = this.env.GA_EVIDENCE_BUNDLE_PATH.trim();
    if (configuredPath.length === 0) {
      return {
        configured: false,
        source: "not_configured",
        status: "not_configured",
        requirements: emptyBundleRequirements,
        inventory: emptyBundleInventory,
        checks: emptyBundleCheckSummary,
        blockerCount: 0,
        blockerCodes: [],
        redaction: safeBundleRedaction({}),
      };
    }

    let raw: string;
    try {
      raw = await readFile(configuredPath, "utf8");
    } catch {
      return invalidBundle("read_failed");
    }

    let bundle: unknown;
    try {
      bundle = JSON.parse(raw);
    } catch {
      return invalidBundle("invalid_json");
    }

    if (
      !isRecord(bundle) ||
      bundle.schemaVersion !== "romeo.ga-evidence-bundle.v1"
    ) {
      return invalidBundle("schema_mismatch");
    }

    const status =
      bundle.status === "passed" || bundle.status === "blocked"
        ? bundle.status
        : "invalid";

    return {
      configured: true,
      source: "configured_file",
      status,
      schemaVersion: "romeo.ga-evidence-bundle.v1",
      ...(typeof bundle.generatedAt === "string"
        ? { generatedAt: bundle.generatedAt }
        : {}),
      requirements: sanitizeBundleRequirements(bundle.requirements),
      ...(isRecord(bundle.release)
        ? { release: sanitizeBundleRelease(bundle.release) }
        : {}),
      ...(isRecord(bundle.ga) ? { ga: sanitizeBundleGa(bundle.ga) } : {}),
      inventory: sanitizeBundleInventory(bundle.inventory),
      checks: summarizeBundleChecks(bundle.checks),
      blockerCount: asArray(bundle.blockers).length,
      blockerCodes: asArray(bundle.blockers)
        .map((item) => (isRecord(item) ? item.code : undefined))
        .slice(0, 100)
        .map((item) => safeToken(item)),
      redaction: safeBundleRedaction(bundle.redaction),
    };
  }
}
