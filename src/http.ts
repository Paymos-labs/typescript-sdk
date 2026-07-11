import { apiErrorFromResponse, ConfigurationError, PaymosError } from "./errors.js";
import { authorizationHeader } from "./signing.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

export interface ClientOptions {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  timeoutMs?: number;
  retry?: RetryOptions | false;
  fetch?: typeof globalThis.fetch;
  clock?: () => number;
}

interface NormalizedOptions {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  fetch: typeof globalThis.fetch;
  clock: () => number;
}

export class HttpClient {
  private readonly options: NormalizedOptions;

  constructor(options: ClientOptions) {
    this.options = normalizeOptions(options);
  }

  async request<T>(method: string, path: string, payload?: unknown, query = ""): Promise<T> {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const url = `${this.options.baseUrl}${path}${query}`;
    let attempt = 0;

    while (true) {
      const timestamp = Math.floor(this.options.clock() / 1000).toString();
      const headers = new Headers({
        Authorization: authorizationHeader(
          this.options.apiKey,
          this.options.apiSecret,
          timestamp,
          method,
          path,
          query,
          body,
        ),
        "X-Request-Timestamp": timestamp,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "paymos-typescript/1.0.0",
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      let response: Response;
      try {
        const requestInit: RequestInit = {
          method,
          headers,
          signal: controller.signal,
        };
        if (body !== "") requestInit.body = body;
        response = await this.options.fetch(url, requestInit);
      } catch (error) {
        if (attempt >= this.options.maxRetries || !isIdempotent(method)) {
          throw new PaymosError(`Paymos request failed: ${errorMessage(error)}`, { cause: error });
        }
        await sleep(backoff(this.options.baseDelayMs, ++attempt));
        continue;
      } finally {
        clearTimeout(timeout);
      }

      if (shouldRetry(method, response.status) && attempt < this.options.maxRetries) {
        const retryAfter = retryAfterMs(response.headers.get("retry-after"));
        await sleep(Math.max(backoff(this.options.baseDelayMs, ++attempt), retryAfter ?? 0));
        continue;
      }

      const responseBody = await response.text();
      if (!response.ok) throw apiErrorFromResponse(response.status, responseBody, response.headers);
      if (responseBody === "") return {} as T;
      try {
        return JSON.parse(responseBody) as T;
      } catch (error) {
        throw new PaymosError("Paymos API returned invalid JSON.", { cause: error });
      }
    }
  }
}

function normalizeOptions(options: ClientOptions): NormalizedOptions {
  if (!options || typeof options !== "object") throw new ConfigurationError("Client options are required.");
  const apiKey = requireString(options.apiKey, "apiKey");
  const apiSecret = requireString(options.apiSecret, "apiSecret");
  const baseUrl = requireString(options.baseUrl ?? "https://api.paymos.io", "baseUrl").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigurationError("timeoutMs must be a positive integer.");
  }
  const maxRetries = options.retry === false ? 0 : options.retry?.maxRetries ?? 2;
  const baseDelayMs = options.retry === false ? 0 : options.retry?.baseDelayMs ?? 150;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new ConfigurationError("retry.maxRetries must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 0) {
    throw new ConfigurationError("retry.baseDelayMs must be a non-negative integer.");
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new ConfigurationError("A Fetch implementation is required.");
  return {
    apiKey,
    apiSecret,
    baseUrl,
    timeoutMs,
    maxRetries,
    baseDelayMs,
    fetch: fetchImplementation,
    clock: options.clock ?? Date.now,
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigurationError(`${name} must be a non-empty string.`);
  }
  return value;
}

function isIdempotent(method: string): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function shouldRetry(method: string, status: number): boolean {
  return status === 429 || (status >= 500 && isIdempotent(method));
}

function backoff(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * 2 ** Math.max(0, attempt - 1);
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
