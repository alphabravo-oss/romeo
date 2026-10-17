import { MemoryObjectStore } from "@romeo/storage";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "../api";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { FileService } from "../services/file-service";
import {
  fileContentHeaders,
  isInlineSafeMimeType,
} from "./file-content-headers";

describe("file content headers", () => {
  it("serves active content as a sandboxed download", () => {
    for (const mimeType of [
      "text/html",
      "text/html; charset=utf-8",
      "image/svg+xml",
      "application/xhtml+xml",
      "text/xml",
      "application/xml",
      "text/javascript",
      "application/octet-stream",
    ]) {
      const headers = fileContentHeaders({
        fileName: "page.html",
        mimeType,
        sizeBytes: 4,
      });
      expect({ mimeType, inline: isInlineSafeMimeType(mimeType) }).toEqual({
        mimeType,
        inline: false,
      });
      expect(headers["content-disposition"]).toMatch(/^attachment;/u);
      expect(headers["content-security-policy"]).toBe(
        "default-src 'none'; sandbox",
      );
      expect(headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("keeps image, PDF, audio and text previews inline", () => {
    for (const mimeType of [
      "image/png",
      "image/webp",
      "application/pdf",
      "audio/mpeg",
      "text/plain",
    ]) {
      const headers = fileContentHeaders({
        fileName: "preview",
        mimeType,
        sizeBytes: 4,
      });
      expect(headers["content-disposition"]).toMatch(/^inline;/u);
      expect(headers["content-security-policy"]).toBeUndefined();
      expect(headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("cannot be broken out of by a hostile file name", () => {
    const headers = fileContentHeaders({
      fileName: 'a"\r\nset-cookie: x=1 é(1).png',
      mimeType: "image/png",
      sizeBytes: 1,
    });
    expect(headers["content-disposition"]).toBe(
      `inline; filename="a___set-cookie: x=1 _(1).png"; filename*=UTF-8''a%22%0D%0Aset-cookie%3A%20x%3D1%20%C3%A9%281%29.png`,
    );
    expect(() => new Headers(headers)).not.toThrow();
  });

  it("does not render an uploaded HTML file on the application origin", async () => {
    const objectStore = new MemoryObjectStore();
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, { objectStore });
    const html = "<script>alert(document.cookie)</script>";
    const uploadResponse = await api.request("/api/v1/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        fileName: "notes.html",
        mimeType: "text/html",
        sizeBytes: html.length,
        dataBase64: Buffer.from(html).toString("base64"),
        purpose: "general",
      }),
    });
    expect(uploadResponse.status).toBe(201);
    const uploaded = (await uploadResponse.json()) as { data: { id: string } };
    await new FileService(repository, objectStore).processLifecycleJob({
      workerId: "file_content_headers_test",
    });

    const response = await api.request(
      `/api/v1/files/${uploaded.data.id}/content`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment;/u,
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
