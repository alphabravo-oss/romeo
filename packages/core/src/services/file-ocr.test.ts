import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { LocalTesseractOcrProvider } from "./file-ocr";

describe("LocalTesseractOcrProvider", () => {
  it("runs a fixed tesseract operation for an image and returns provenance", async () => {
    const runner = vi.fn(async (command: string, args: string[]) => {
      expect(command).toBe("/opt/romeo/bin/tesseract");
      expect(args.slice(1)).toEqual(["stdout", "-l", "eng"]);
      return { stdout: "Scanned approval text\n" };
    });
    const provider = new LocalTesseractOcrProvider({
      runner,
      tesseractPath: "/opt/romeo/bin/tesseract",
    });

    await expect(
      provider.recognize({
        bytes: new Uint8Array([137, 80, 78, 71]),
        fileName: "scan.png",
        mimeType: "image/png",
      }),
    ).resolves.toEqual({
      content: "Scanned approval text",
      provider: "local-tesseract",
      pageCount: 1,
      confidence: null,
    });
    expect(runner).toHaveBeenCalledOnce();
  });

  it("renders a bounded PDF page set before OCR without using a shell", async () => {
    const runner = vi.fn(
      async (command: string, args: string[], options: { cwd: string }) => {
        if (command === "/opt/romeo/bin/pdftoppm") {
          expect(args.slice(0, 7)).toEqual([
            "-png",
            "-r",
            "150",
            "-f",
            "1",
            "-l",
            "2",
          ]);
          await writeFile(join(options.cwd, "page-1.png"), "page one");
          await writeFile(join(options.cwd, "page-2.png"), "page two");
          return { stdout: "" };
        }
        return {
          stdout: args[0]?.endsWith("page-1.png")
            ? "First page"
            : "Second page",
        };
      },
    );
    const provider = new LocalTesseractOcrProvider({
      maxPages: 2,
      pdfToPpmPath: "/opt/romeo/bin/pdftoppm",
      runner,
      tesseractPath: "/opt/romeo/bin/tesseract",
    });

    const result = await provider.recognize({
      bytes: new TextEncoder().encode("%PDF-1.4"),
      fileName: "scan.pdf",
      mimeType: "application/pdf",
    });

    expect(result).toMatchObject({
      content: "First page\n\nSecond page",
      pageCount: 2,
      provider: "local-tesseract",
    });
    expect(runner).toHaveBeenCalledTimes(3);
  });
});
