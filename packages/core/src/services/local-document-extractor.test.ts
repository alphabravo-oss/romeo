import { describe, expect, it } from "vitest";

import { disabledFileOcrProvider } from "./file-ocr";
import { LocalDocumentTextExtractor } from "./local-document-extractor";

describe("LocalDocumentTextExtractor OCR", () => {
  it("OCRs images through the configured provider", async () => {
    const extractor = new LocalDocumentTextExtractor({
      ocr: {
        async recognize(input) {
          expect(input.mimeType).toBe("image/png");
          return {
            content: "Scanned handbook page",
            provider: "local-tesseract",
            pageCount: 1,
            confidence: 0.91,
          };
        },
      },
    });
    await expect(
      extractor.extract({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "scan.png",
        mimeType: "image/png",
      }),
    ).resolves.toMatchObject({
      content: "Scanned handbook page",
      metadata: {
        extractor: "ocr",
        ocrProvider: "local-tesseract",
        pageCount: 1,
        ocrConfidence: 0.91,
      },
    });
  });

  it("falls back to OCR when PDF text extraction fails", async () => {
    const extractor = new LocalDocumentTextExtractor({
      ocr: {
        async recognize() {
          return {
            content: "Scanned PDF body",
            provider: "local-tesseract",
            pageCount: 2,
            confidence: null,
          };
        },
      },
      pdf: {
        async runner() {
          throw new Error("pdftotext missing");
        },
      },
    });
    const result = await extractor.extract({
      bytes: new TextEncoder().encode("%PDF-1.4 scanned"),
      fileName: "scan.pdf",
      mimeType: "application/pdf",
    });
    expect(result.content).toBe("Scanned PDF body");
    expect(result.metadata.extractor).toBe("ocr");
  });

  it("keeps the PDF error when OCR is disabled", async () => {
    const extractor = new LocalDocumentTextExtractor({
      ocr: disabledFileOcrProvider,
      pdf: {
        async runner() {
          throw new Error("pdftotext missing");
        },
      },
    });
    await expect(
      extractor.extract({
        bytes: new TextEncoder().encode("%PDF-1.4"),
        fileName: "scan.pdf",
        mimeType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "pdf_extraction_failed" });
  });
});
