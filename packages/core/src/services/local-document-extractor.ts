import type { ExtractedKnowledgeText } from "@romeo/rag";

import { ApiError } from "../errors";
import {
  disabledFileOcrProvider,
  ocrImageMimeTypes,
  type FileOcrProvider,
} from "./file-ocr";
import type { KnowledgeBinaryExtractor } from "./knowledge-extraction-worker";
import {
  LocalOoxmlTextExtractor,
  type LocalOoxmlTextExtractorOptions,
} from "./local-ooxml-extractor";
import {
  LocalPdfTextExtractor,
  type LocalPdfTextExtractorOptions,
} from "./local-pdf-extractor";

export interface LocalDocumentTextExtractorOptions {
  ocr?: FileOcrProvider;
  ooxml?: LocalOoxmlTextExtractorOptions;
  pdf?: LocalPdfTextExtractorOptions;
}

const pdfMimeType = "application/pdf";
const ooxmlMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export class LocalDocumentTextExtractor implements KnowledgeBinaryExtractor {
  private readonly ocr: FileOcrProvider;
  private readonly ooxml: LocalOoxmlTextExtractor;
  private readonly pdf: LocalPdfTextExtractor;

  constructor(options: LocalDocumentTextExtractorOptions = {}) {
    this.ocr = options.ocr ?? disabledFileOcrProvider;
    this.ooxml = new LocalOoxmlTextExtractor(options.ooxml);
    this.pdf = new LocalPdfTextExtractor(options.pdf);
  }

  async extract(input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
  }): Promise<ExtractedKnowledgeText> {
    const mimeType = normalizeMimeType(input.mimeType);
    if (ocrImageMimeTypes.has(mimeType)) return this.ocrExtract(input);
    if (mimeType === pdfMimeType) {
      try {
        return await this.pdf.extract({ ...input, mimeType });
      } catch (error) {
        return this.ocrExtractOrRethrow(input, error);
      }
    }
    if (ooxmlMimeTypes.has(mimeType))
      return this.ooxml.extract({ ...input, mimeType });
    throw new ApiError(
      "unsupported_media_type",
      "Local document extraction only supports PDF, Office, and image sources.",
      415,
      { mimeType },
    );
  }

  private async ocrExtract(input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
  }): Promise<ExtractedKnowledgeText> {
    const result = await this.ocr.recognize(input);
    return {
      content: result.content,
      metadata: {
        extractor: "ocr",
        mimeType: normalizeMimeType(input.mimeType),
        ocrProvider: result.provider,
        pageCount: result.pageCount,
        ...(result.confidence === null
          ? {}
          : { ocrConfidence: result.confidence }),
      },
    };
  }

  private async ocrExtractOrRethrow(
    input: {
      bytes: Uint8Array;
      fileName: string;
      mimeType: string;
    },
    primaryError: unknown,
  ): Promise<ExtractedKnowledgeText> {
    try {
      return await this.ocrExtract(input);
    } catch (ocrError) {
      if (
        ocrError instanceof ApiError &&
        ocrError.code === "file_ocr_unavailable"
      ) {
        throw primaryError;
      }
      throw ocrError;
    }
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
