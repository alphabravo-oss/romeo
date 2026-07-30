import type { BaseModel, Provider } from "../features/types";
import type { FileObject } from "../features/files";

export function listImageGenerationModels(
  models: BaseModel[],
  providers: Provider[],
): BaseModel[] {
  const providerById = new Map(
    providers.map((provider) => [provider.id, provider]),
  );
  return models.filter(
    (model) =>
      model.enabled &&
      model.available !== false &&
      model.capabilities.imageGeneration &&
      providerById.get(model.providerId)?.enabled === true &&
      ["openai-compatible", "openai-responses-compatible"].includes(
        providerById.get(model.providerId)?.type ?? "",
      ),
  );
}

export function fileExtractionLabel(file: FileObject): string {
  switch (file.extraction.status) {
    case "succeeded":
      return `Text ready · ${file.extraction.quality} quality`;
    case "failed":
      return `Text unavailable · ${fileExtractionFailureMessage(file.extraction.failureCode)}`;
    case "pending":
      return "Text extraction pending";
    case "processing":
      return "Text extraction in progress";
    case "not_applicable":
      return "No text extraction";
  }
}

function fileExtractionFailureMessage(code: string | null): string {
  switch (code) {
    case "knowledge_extractor_unavailable":
      return "document extraction is not configured";
    case "extraction_input_too_large":
      return "document is too large to extract";
    case "empty_extraction":
      return "no readable text was found";
    case "invalid_pdf_header":
    case "pdf_extraction_failed":
      return "PDF text extraction failed";
    default:
      return "text extraction failed";
  }
}

export function materializePrompt(body: string): string {
  const variables = [
    ...new Set(
      [
        ...body.matchAll(
          new RegExp("\\{\\{\\s*([A-Za-z][A-Za-z0-9_-]*)\\s*\\}\\}", "gu"),
        ),
      ].map((match) => match[1]!),
    ),
  ];
  let result = body;
  for (const variable of variables) {
    const value = window.prompt(`Value for ${variable}`) ?? `{{${variable}}}`;
    result = result.replace(new RegExp(`{{\\s*${variable}\\s*}}`, "gu"), value);
  }
  return result;
}
