import { RomeoApiError } from "./errors";
import { parseSseStream, type ServerSentEvent } from "./sse";
import type {
  ApiEnvelope,
  ApiErrorEnvelope,
  RomeoClientOptions,
  HttpMethod,
} from "./types";

export class RomeoTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RomeoClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async data<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const envelope = await this.request<ApiEnvelope<T>>(method, path, body);
    return envelope.data;
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: this.headers(body !== undefined),
    };

    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) await this.throwApiError(response);
    return (await response.json()) as T;
  }

  async empty(method: HttpMethod, path: string, body?: unknown): Promise<void> {
    const init: RequestInit = {
      method,
      headers: this.headers(body !== undefined),
    };

    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) await this.throwApiError(response);
  }

  async text(
    method: HttpMethod,
    path: string,
    accept = "text/plain",
  ): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { ...this.headers(), accept },
    });
    if (!response.ok) await this.throwApiError(response);
    return response.text();
  }

  async bytes(method: HttpMethod, path: string): Promise<Uint8Array> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
    });
    if (!response.ok) await this.throwApiError(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  async *events(path: string): AsyncIterable<ServerSentEvent> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { ...this.headers(), accept: "text/event-stream" },
    });
    if (!response.ok) await this.throwApiError(response);
    if (response.body === null)
      throw new RomeoApiError(
        "Romeo API returned an empty event stream.",
        response.status,
      );
    yield* parseSseStream(response.body);
  }

  private headers(hasBody = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.options.apiKey)
      headers.authorization = `Bearer ${this.options.apiKey}`;
    if (hasBody) headers["content-type"] = "application/json";
    return headers;
  }

  private async throwApiError(response: Response): Promise<never> {
    const body = (await response.json().catch(() => undefined)) as
      | Partial<ApiErrorEnvelope>
      | undefined;
    const apiError = isApiErrorEnvelope(body) ? body : undefined;
    throw new RomeoApiError(
      body?.error?.message ??
        `Romeo API request failed with ${response.status}.`,
      response.status,
      apiError,
    );
  }
}

function isApiErrorEnvelope(
  body: Partial<ApiErrorEnvelope> | undefined,
): body is ApiErrorEnvelope {
  return (
    typeof body?.error?.code === "string" &&
    typeof body.error.message === "string" &&
    typeof body.error.request_id === "string"
  );
}
