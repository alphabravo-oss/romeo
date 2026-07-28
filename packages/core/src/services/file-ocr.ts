import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { ApiError } from "../errors";

export interface FileOcrResult {
  content: string;
  provider: string;
  pageCount: number;
  confidence: number | null;
}

export interface FileOcrProvider {
  recognize(input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
  }): Promise<FileOcrResult>;
}

export const disabledFileOcrProvider: FileOcrProvider = {
  async recognize() {
    throw new ApiError(
      "file_ocr_unavailable",
      "OCR is not configured for this deployment.",
      503,
    );
  },
};

export interface FixedOcrCommandResult {
  stdout: string;
}

export type FixedOcrCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; maxBuffer: number; timeoutMs: number },
) => Promise<FixedOcrCommandResult>;

export interface LocalTesseractOcrOptions {
  language?: string;
  maxBytes?: number;
  maxPages?: number;
  pdfToPpmPath?: string;
  runner?: FixedOcrCommandRunner;
  tesseractPath?: string;
  timeoutMs?: number;
}

const supportedImageMimeTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export class LocalTesseractOcrProvider implements FileOcrProvider {
  constructor(private readonly options: LocalTesseractOcrOptions = {}) {}

  async recognize(input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
  }): Promise<FileOcrResult> {
    const maxBytes = this.options.maxBytes ?? 20_000_000;
    if (input.bytes.byteLength > maxBytes)
      throw new ApiError(
        "file_ocr_input_too_large",
        "The file is too large for local OCR.",
        413,
        { maxBytes },
      );
    const mimeType =
      input.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (
      mimeType !== "application/pdf" &&
      !supportedImageMimeTypes.has(mimeType)
    )
      throw new ApiError(
        "file_ocr_type_unsupported",
        "OCR supports PDF and approved image formats.",
        415,
        { mimeType },
      );

    const directory = await mkdtemp(join(tmpdir(), "romeo-ocr-"));
    try {
      const pagePaths =
        mimeType === "application/pdf"
          ? await this.renderPdfPages(directory, input.bytes)
          : [
              await this.writeImage(
                directory,
                input.fileName,
                mimeType,
                input.bytes,
              ),
            ];
      const content: string[] = [];
      for (const pagePath of pagePaths) {
        const result = await this.run(
          this.options.tesseractPath ?? "tesseract",
          [pagePath, "stdout", "-l", this.options.language ?? "eng"],
          directory,
        );
        const text = result.stdout.replace(/\r\n?/gu, "\n").trim();
        if (text.length > 0) content.push(text);
      }
      const joined = content.join("\n\n").trim();
      if (joined.length === 0)
        throw new ApiError(
          "file_ocr_empty",
          "OCR did not find readable text.",
          422,
        );
      return {
        content: joined.slice(0, 1_000_000),
        provider: "local-tesseract",
        pageCount: pagePaths.length,
        confidence: null,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("file_ocr_failed", "OCR processing failed.", 422);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async renderPdfPages(
    directory: string,
    bytes: Uint8Array,
  ): Promise<string[]> {
    const source = join(directory, "source.pdf");
    const prefix = join(directory, "page");
    await writeFile(source, bytes);
    await this.run(
      this.options.pdfToPpmPath ?? "pdftoppm",
      [
        "-png",
        "-r",
        "150",
        "-f",
        "1",
        "-l",
        String(this.options.maxPages ?? 20),
        source,
        prefix,
      ],
      directory,
    );
    const pages = (await readdir(directory))
      .filter((name) => /^page-\d+\.png$/u.test(name))
      .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
      .map((name) => join(directory, name));
    if (pages.length === 0)
      throw new ApiError(
        "file_ocr_pdf_render_empty",
        "PDF rendering produced no OCR pages.",
        422,
      );
    return pages;
  }

  private async writeImage(
    directory: string,
    fileName: string,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<string> {
    const extension =
      (imageExtension(mimeType) ?? extname(fileName).slice(0, 8)) || ".img";
    const path = join(directory, `source${extension}`);
    await writeFile(path, bytes);
    return path;
  }

  private run(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<FixedOcrCommandResult> {
    const runner = this.options.runner ?? fixedCommandRunner;
    return runner(command, args, {
      cwd,
      maxBuffer: 2_000_000,
      timeoutMs: this.options.timeoutMs ?? 30_000,
    });
  }
}

function imageExtension(mimeType: string): string | undefined {
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return undefined;
}

function fixedCommandRunner(
  command: string,
  args: string[],
  options: { cwd: string; maxBuffer: number; timeoutMs: number },
): Promise<FixedOcrCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        encoding: "utf8",
        env: minimalCommandEnvironment(),
        maxBuffer: options.maxBuffer,
        timeout: options.timeoutMs,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout });
      },
    );
  });
}

function minimalCommandEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "LANG",
    "LC_ALL",
    "PATH",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "WINDIR",
  ]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}
