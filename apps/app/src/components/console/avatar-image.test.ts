import { describe, expect, it } from "vitest";

import {
  AVATAR_MAX_SOURCE_BYTES,
  coverCrop,
  isAcceptedAvatarType,
  validateAvatarFile,
} from "./avatar-image";

describe("avatar image", () => {
  describe("coverCrop", () => {
    it("takes the whole frame when the source is already square", () => {
      expect(coverCrop(512, 512)).toEqual({ x: 0, y: 0, size: 512 });
    });

    it("crops the long axis and keeps the centre on a landscape source", () => {
      // 800x400 -> a 400 square starting 200 in, so the middle survives.
      expect(coverCrop(800, 400)).toEqual({ x: 200, y: 0, size: 400 });
    });

    it("crops the long axis on a portrait source", () => {
      expect(coverCrop(400, 900)).toEqual({ x: 0, y: 250, size: 400 });
    });

    it("rounds the offset rather than emitting a fractional source rect", () => {
      const crop = coverCrop(101, 100);
      expect(Number.isInteger(crop.x)).toBe(true);
      expect(crop).toEqual({ x: 1, y: 0, size: 100 });
    });
  });

  describe("validateAvatarFile", () => {
    it("accepts the image types a browser can decode", () => {
      for (const type of ["image/png", "image/jpeg", "image/webp"]) {
        expect(validateAvatarFile({ size: 1000, type })).toBeUndefined();
      }
    });

    it("rejects a non-image by type, naming what it got", () => {
      expect(validateAvatarFile({ size: 10, type: "application/pdf" })).toEqual(
        {
          reason: "type",
          detail: "application/pdf",
        },
      );
    });

    it("rejects a file with no type at all", () => {
      expect(validateAvatarFile({ size: 10, type: "" })?.reason).toBe("type");
    });

    it("rejects an oversized source before it reaches a canvas", () => {
      expect(
        validateAvatarFile({
          size: AVATAR_MAX_SOURCE_BYTES + 1,
          type: "image/png",
        }),
      ).toEqual({
        reason: "size",
        detail: String(AVATAR_MAX_SOURCE_BYTES + 1),
      });
    });

    it("allows a file exactly at the cap", () => {
      expect(
        validateAvatarFile({
          size: AVATAR_MAX_SOURCE_BYTES,
          type: "image/png",
        }),
      ).toBeUndefined();
    });

    it("checks type before size, so a huge non-image reports the real problem", () => {
      expect(
        validateAvatarFile({
          size: AVATAR_MAX_SOURCE_BYTES * 10,
          type: "text/plain",
        })?.reason,
      ).toBe("type");
    });
  });

  it("does not accept types the avatar <img> cannot render", () => {
    expect(isAcceptedAvatarType("image/tiff")).toBe(false);
    expect(isAcceptedAvatarType("image/png")).toBe(true);
  });
});
