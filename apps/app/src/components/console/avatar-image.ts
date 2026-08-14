/**
 * Turning a dropped file into a custom model's avatar.
 *
 * Avatars are stored inline on the agent as a `data:` URI rather than uploaded
 * through the files API. That keeps a replaced avatar from leaving an orphaned
 * blob behind, works in air-gapped installs, and needs no new endpoint — the
 * contract already accepts a data URI because `z.url()` does. It is only
 * defensible because we downscale first: a 128px square is a few kilobytes, so
 * this is a small string, not a smuggled file upload.
 */

/** Rendered avatars never exceed 72px; 128 covers 2x displays with headroom. */
export const AVATAR_SIZE = 128;

/** Refuse anything a browser cannot decode into an <img>. */
export const AVATAR_ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/**
 * Cap on the *source* file. The encoded result is far smaller, but reading a
 * 40MB bitmap into a canvas is worth refusing outright.
 */
export const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/** Cap on the encoded result, matching the contract's `avatarUrl` max. */
export const AVATAR_MAX_ENCODED_CHARS = AVATAR_URL_MAX;

export type AvatarRejection =
  | { reason: "type"; detail: string }
  | { reason: "size"; detail: string }
  | { reason: "encode"; detail: string };

export function isAcceptedAvatarType(type: string): boolean {
  return (AVATAR_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/**
 * Validate before touching a canvas, so a bad file fails fast with a reason the
 * UI can name.
 */
export function validateAvatarFile(file: {
  size: number;
  type: string;
}): AvatarRejection | undefined {
  if (!isAcceptedAvatarType(file.type)) {
    return { reason: "type", detail: file.type || "unknown" };
  }
  if (file.size > AVATAR_MAX_SOURCE_BYTES) {
    return { reason: "size", detail: String(file.size) };
  }
  return undefined;
}

/**
 * Source rectangle for a centre-crop to a square — the "cover" fit.
 *
 * Letterboxing an avatar leaves bars inside a rounded tile, so we crop the long
 * axis instead and keep the middle.
 */
export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number; size: number } {
  const size = Math.min(sourceWidth, sourceHeight);
  return {
    x: Math.round((sourceWidth - size) / 2),
    y: Math.round((sourceHeight - size) / 2),
    size,
  };
}

/**
 * Read an image file and return a square, downscaled `data:` URI.
 *
 * Browser-only: needs createImageBitmap and a canvas. Rejects with an
 * {@link AvatarRejection} so callers can render a specific message.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const rejection = validateAvatarFile(file);
  if (rejection) throw rejection;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (caught) {
    throw {
      reason: "encode",
      detail: caught instanceof Error ? caught.message : "decode failed",
    } as AvatarRejection;
  }

  const crop = coverCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw { reason: "encode", detail: "no 2d context" } as AvatarRejection;
  }
  context.drawImage(
    bitmap,
    crop.x,
    crop.y,
    crop.size,
    crop.size,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();

  // WebP first — roughly half the bytes of PNG at this size. Older engines that
  // do not encode it silently hand back a PNG data URI, which still works.
  const encoded = canvas.toDataURL("image/webp", 0.85);
  const result = encoded.startsWith("data:image/webp")
    ? encoded
    : canvas.toDataURL("image/png");
  if (result.length > AVATAR_MAX_ENCODED_CHARS) {
    throw { reason: "size", detail: String(result.length) } as AvatarRejection;
  }
  return result;
}
import { AVATAR_URL_MAX } from "@romeo/contracts/avatar-url";
