import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

import type { WebsiteConnectorHostAddress } from "./data-connector-executors";

export type DnsPinnedFetch = (
  url: URL,
  init: RequestInit,
  addresses: WebsiteConnectorHostAddress[],
) => Promise<Response>;

/**
 * Performs an HTTP(S) request whose socket lookup is restricted to addresses
 * that were already resolved and accepted by the egress policy. The original
 * URL hostname remains in Host and TLS SNI, so certificate validation is not
 * weakened while DNS rebinding between policy evaluation and connect is closed.
 */
export const dnsPinnedFetch: DnsPinnedFetch = async (url, init, addresses) => {
  if (addresses.length === 0) {
    throw new TypeError("DNS pinning requires at least one approved address.");
  }
  const lookup = pinnedLookup(addresses);
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
        lookup,
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
  addresses: WebsiteConnectorHostAddress[],
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
          {
            code: "ENOTFOUND",
          },
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
