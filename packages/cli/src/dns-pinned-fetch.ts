import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

import type { ToolDispatchDnsAddress } from "./tool-dispatch-worker";

export type ToolDispatchPinnedFetch = (
  url: URL,
  init: RequestInit,
  addresses: ToolDispatchDnsAddress[],
) => Promise<Response>;

/**
 * Connects only to addresses accepted by the worker policy while retaining the
 * original hostname for Host and TLS SNI/certificate verification.
 */
export const dnsPinnedFetch: ToolDispatchPinnedFetch = async (
  url,
  init,
  addresses,
) => {
  const approved = addresses.flatMap((address) =>
    address.family === 4 || address.family === 6
      ? [{ address: address.address, family: address.family as 4 | 6 }]
      : [],
  );
  if (approved.length === 0) {
    throw new TypeError("DNS pinning requires at least one approved address.");
  }
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const body = requestBody(init.body);
  if (body !== undefined && headers["content-length"] === undefined) {
    headers["content-length"] = String(body.byteLength);
  }

  return await new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: init.method ?? "GET",
        headers,
        lookup: pinnedLookup(approved),
        signal: init.signal ?? undefined,
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else {
            responseHeaders.set(name, value);
          }
        }
        const status = incoming.statusCode ?? 502;
        const bodyless = [101, 204, 205, 304].includes(status);
        resolve(
          new Response(
            bodyless
              ? null
              : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
            {
              status,
              statusText: incoming.statusMessage ?? "",
              headers: responseHeaders,
            },
          ),
        );
      },
    );
    request.once("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
};

function pinnedLookup(
  addresses: Array<{ address: string; family: 4 | 6 }>,
): LookupFunction {
  return ((_hostname, options, callback) => {
    const normalizedOptions =
      typeof options === "number" ? { family: options } : options;
    const eligible = addresses.filter(
      (address) =>
        normalizedOptions.family === undefined ||
        normalizedOptions.family === 0 ||
        normalizedOptions.family === address.family,
    );
    if (eligible.length === 0) {
      callback(
        Object.assign(
          new Error("No approved address matches the requested family."),
          { code: "ENOTFOUND" },
        ),
        "",
        0,
      );
      return;
    }
    if (
      typeof normalizedOptions === "object" &&
      normalizedOptions.all === true
    ) {
      callback(null, eligible);
      return;
    }
    const selected = eligible[0]!;
    callback(null, selected.address, selected.family);
  }) as LookupFunction;
}

function requestBody(body: BodyInit | null | undefined): Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new TypeError("DNS-pinned requests require a buffered request body.");
}
