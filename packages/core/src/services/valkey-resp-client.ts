import { connect as connectSocket, type Socket } from "node:net";
import { connect as connectTlsSocket, type TLSSocket } from "node:tls";

export type RespValue = string | number | null | RespValue[];

export class ValkeyRespError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValkeyRespError";
  }
}

export class ValkeyRespClient {
  constructor(
    private readonly options: { timeoutMs: number; url: string },
  ) {}

  async command(args: string[]): Promise<RespValue> {
    const url = new URL(this.options.url);
    const socket = await this.openSocket(url);
    try {
      await this.authenticate(socket, url);
      await this.selectDatabase(socket, url);
      return await sendCommand(socket, args, this.options.timeoutMs);
    } finally {
      socket.end();
      socket.destroy();
    }
  }

  private openSocket(url: URL): Promise<Socket | TLSSocket> {
    return new Promise((resolve, reject) => {
      const host = url.hostname;
      const port = url.port === "" ? 6379 : Number(url.port);
      let socket: Socket | TLSSocket | undefined;
      const fail = (error: Error) => {
        socket?.destroy();
        reject(error);
      };
      const onConnect = () => {
        socket?.off("error", fail);
        socket?.setTimeout(this.options.timeoutMs);
        if (socket === undefined) {
          reject(new Error("valkey_connection_missing"));
          return;
        }
        resolve(socket);
      };
      socket =
        url.protocol === "rediss:"
          ? connectTlsSocket({ host, port, servername: host }, onConnect)
          : connectSocket({ host, port }, onConnect);
      socket.once("error", fail);
      socket.setTimeout(this.options.timeoutMs, () =>
        fail(new Error("valkey_connection_timeout")),
      );
    });
  }

  private async authenticate(
    socket: Socket | TLSSocket,
    url: URL,
  ): Promise<void> {
    if (url.username === "" && url.password === "") return;
    const password = decodeURIComponent(url.password);
    if (url.username === "") {
      await sendCommand(socket, ["AUTH", password], this.options.timeoutMs);
      return;
    }
    await sendCommand(
      socket,
      ["AUTH", decodeURIComponent(url.username), password],
      this.options.timeoutMs,
    );
  }

  private async selectDatabase(
    socket: Socket | TLSSocket,
    url: URL,
  ): Promise<void> {
    const database = parseDatabaseIndex(url.pathname);
    if (database === undefined) return;
    await sendCommand(socket, ["SELECT", String(database)], this.options.timeoutMs);
  }
}

function parseDatabaseIndex(pathname: string): number | undefined {
  const normalized = pathname.replace(/^\/+/, "").trim();
  if (normalized === "") return undefined;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("valkey_database_index_invalid");
  }
  return parsed;
}

function sendCommand(
  socket: Socket | TLSSocket,
  args: string[],
  timeoutMs: number,
): Promise<RespValue> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("valkey_command_timeout"));
    }, timeoutMs);
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const parsed = parseResp(buffer, 0);
        if (parsed === undefined) return;
        cleanup();
        resolve(parsed.value);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(encodeCommand(args));
  });
}

function encodeCommand(args: string[]): Buffer {
  const chunks: string[] = [`*${args.length}\r\n`];
  for (const arg of args) {
    const bytes = Buffer.byteLength(arg);
    chunks.push(`$${bytes}\r\n${arg}\r\n`);
  }
  return Buffer.from(chunks.join(""), "utf8");
}

function parseResp(
  buffer: Buffer,
  offset: number,
): { value: RespValue; offset: number } | undefined {
  const type = String.fromCharCode(buffer[offset] ?? 0);
  if (type === "+") return parseSimpleString(buffer, offset);
  if (type === "-") return parseError(buffer, offset);
  if (type === ":") return parseInteger(buffer, offset);
  if (type === "$") return parseBulkString(buffer, offset);
  if (type === "*") return parseArray(buffer, offset);
  throw new Error("valkey_response_invalid");
}

function parseSimpleString(
  buffer: Buffer,
  offset: number,
): { value: string; offset: number } | undefined {
  const end = indexOfLineEnd(buffer, offset + 1);
  if (end === -1) return undefined;
  return { value: buffer.toString("utf8", offset + 1, end), offset: end + 2 };
}

function parseError(
  buffer: Buffer,
  offset: number,
): { value: never; offset: number } | undefined {
  const end = indexOfLineEnd(buffer, offset + 1);
  if (end === -1) return undefined;
  throw new ValkeyRespError(buffer.toString("utf8", offset + 1, end));
}

function parseInteger(
  buffer: Buffer,
  offset: number,
): { value: number; offset: number } | undefined {
  const end = indexOfLineEnd(buffer, offset + 1);
  if (end === -1) return undefined;
  return {
    value: Number(buffer.toString("utf8", offset + 1, end)),
    offset: end + 2,
  };
}

function parseBulkString(
  buffer: Buffer,
  offset: number,
): { value: string | null; offset: number } | undefined {
  const end = indexOfLineEnd(buffer, offset + 1);
  if (end === -1) return undefined;
  const length = Number(buffer.toString("utf8", offset + 1, end));
  if (length === -1) return { value: null, offset: end + 2 };
  const start = end + 2;
  const bodyEnd = start + length;
  if (buffer.length < bodyEnd + 2) return undefined;
  return {
    value: buffer.toString("utf8", start, bodyEnd),
    offset: bodyEnd + 2,
  };
}

function parseArray(
  buffer: Buffer,
  offset: number,
): { value: RespValue[]; offset: number } | undefined {
  const end = indexOfLineEnd(buffer, offset + 1);
  if (end === -1) return undefined;
  const length = Number(buffer.toString("utf8", offset + 1, end));
  if (length < 0) return { value: [], offset: end + 2 };
  let cursor = end + 2;
  const value: RespValue[] = [];
  for (let index = 0; index < length; index += 1) {
    const parsed = parseResp(buffer, cursor);
    if (parsed === undefined) return undefined;
    value.push(parsed.value);
    cursor = parsed.offset;
  }
  return { value, offset: cursor };
}

function indexOfLineEnd(buffer: Buffer, offset: number): number {
  for (let index = offset; index < buffer.length - 1; index += 1) {
    if (buffer[index] === 13 && buffer[index + 1] === 10) return index;
  }
  return -1;
}
