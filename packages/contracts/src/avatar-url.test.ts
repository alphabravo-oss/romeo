import { describe, expect, it } from "vitest";

import {
  isAllowedAvatarUrl,
  isBlockedAvatarHostname,
  resolveAvatarImageSource,
} from "./avatar-url";
import { ManagedModelAvatarUrlSchema } from "./managed-model-schemas";

describe("avatar URL policy", () => {
  it("accepts public HTTPS and normalizes its source", () => {
    expect(
      resolveAvatarImageSource(" HTTPS://cdn.example.com/avatar.png "),
    ).toEqual({
      kind: "remote",
      src: "https://cdn.example.com/avatar.png",
    });
    expect(resolveAvatarImageSource("https://8.8.8.8/avatar.png")?.kind).toBe(
      "remote",
    );
    expect(
      resolveAvatarImageSource("https://[2606:4700:4700::1111]/avatar.png")
        ?.kind,
    ).toBe("remote");
  });

  it.each([
    "http://cdn.example.com/avatar.png",
    "ftp://cdn.example.com/avatar.png",
    "javascript:alert(1)",
    "https://user:secret@cdn.example.com/avatar.png",
    "not a URL",
  ])("rejects unsafe URL syntax or protocol: %s", (value) => {
    expect(resolveAvatarImageSource(value)).toBeUndefined();
    expect(isAllowedAvatarUrl(value)).toBe(false);
  });

  it.each([
    "localhost",
    "images.localhost",
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::",
    "::1",
    "::ffff:7f00:1",
    "fc00::1",
    "fd12::1",
    "fe80::1",
  ])("rejects a non-public literal host: %s", (hostname) => {
    expect(isBlockedAvatarHostname(hostname)).toBe(true);
    const authority = hostname.includes(":") ? `[${hostname}]` : hostname;
    expect(
      resolveAvatarImageSource(`https://${authority}/avatar.png`),
    ).toBeUndefined();
  });

  it("rejects alternate IPv4 spellings after URL normalization", () => {
    for (const value of [
      "https://127.1/avatar.png",
      "https://2130706433/avatar.png",
      "https://0x7f000001/avatar.png",
    ]) {
      expect(resolveAvatarImageSource(value)).toBeUndefined();
    }
  });

  it("allows only inert raster image data URLs", () => {
    expect(resolveAvatarImageSource("data:image/png;base64,aGVsbG8=")).toEqual({
      kind: "inline",
      src: "data:image/png;base64,aGVsbG8=",
    });
    expect(
      resolveAvatarImageSource("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
    ).toBeUndefined();
    expect(
      resolveAvatarImageSource("data:text/html;base64,aGVsbG8="),
    ).toBeUndefined();
    expect(
      resolveAvatarImageSource("data:image/png;base64,%%%"),
    ).toBeUndefined();
  });

  it("uses the same policy for managed-model writes", () => {
    expect(
      ManagedModelAvatarUrlSchema.safeParse(
        "https://cdn.example.com/avatar.png",
      ).success,
    ).toBe(true);
    expect(
      ManagedModelAvatarUrlSchema.safeParse(
        "https://169.254.169.254/latest/meta-data",
      ).success,
    ).toBe(false);
    expect(ManagedModelAvatarUrlSchema.safeParse("").success).toBe(true);
  });
});
