import {
  CONTENT_POLICY_DETECTOR_CODES,
  evaluateContentPolicyStrings,
  type ContentPolicyAction,
  type ContentPolicyDetectorActions,
  type ContentPolicyEvaluation,
} from "./content-policy-service";

export const MODALITY_SURFACES = [
  "ocr",
  "transcript",
  "extracted",
  "text",
  "tool_result",
  "output_text",
  "image_classifier",
] as const;
export type ModalitySurface = (typeof MODALITY_SURFACES)[number];

export interface ModalitySurfaceInput {
  kind: ModalitySurface;
  content: string;
  encoding?: string;
}

export interface ImageClassifierSignal {
  label: string;
  score: number;
}

export function normalizePolicyEncoding(content: string): string {
  const withoutBom = content.replace(/^\uFEFF/u, "");
  return withoutBom.normalize("NFC");
}

export function evaluateModalityContentPolicy(input: {
  surfaces: ModalitySurfaceInput[];
  detectors: ContentPolicyDetectorActions;
  imageClassifier?: ImageClassifierSignal;
}): ContentPolicyEvaluation & {
  normalized: string[];
  classifierAdvisory: true;
  surfacesScanned: ModalitySurface[];
} {
  const ordered = [...input.surfaces].sort(
    (left, right) =>
      MODALITY_SURFACES.indexOf(left.kind) - MODALITY_SURFACES.indexOf(right.kind),
  );
  const textSurfaces = ordered.filter((surface) => surface.kind !== "image_classifier");
  const normalized = textSurfaces.map((surface) =>
    normalizePolicyEncoding(surface.content),
  );
  const evaluation = evaluateContentPolicyStrings(normalized, input.detectors);
  return {
    ...evaluation.result,
    normalized: evaluation.contents,
    classifierAdvisory: true,
    surfacesScanned: ordered.map((surface) => surface.kind),
  };
}

export function applyModalityPolicyToText(input: {
  content: string;
  detectors: ContentPolicyDetectorActions;
}): { content: string; evaluation: ContentPolicyEvaluation } {
  const evaluated = evaluateContentPolicyStrings(
    [normalizePolicyEncoding(input.content)],
    input.detectors,
  );
  return { content: evaluated.contents[0]!, evaluation: evaluated.result };
}

export function classifierCannotAuthoritativelyBlock(
  detectors: ContentPolicyDetectorActions,
  classifier?: ImageClassifierSignal,
): boolean {
  void detectors;
  void classifier;
  return true;
}

export function modalityDetectorCodes(): readonly string[] {
  return CONTENT_POLICY_DETECTOR_CODES;
}

export type { ContentPolicyAction };
