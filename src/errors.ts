import type { ProblemDetails, ProblemError } from "./types.js";
import { fromWire } from "./wire.js";

export class PaymosError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConfigurationError extends PaymosError {}
export class SignatureMismatchError extends PaymosError {}
export class TimestampSkewError extends PaymosError {}

export class ApiError extends PaymosError {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;
  readonly problem: ProblemDetails | null;

  constructor(status: number, body: string, headers: Headers) {
    const problem = parseProblem(status, body);
    const detail = problem?.detail || problem?.code || problem?.title;
    super(`Paymos API ${status}: ${detail || body || "empty response"}`);
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.problem = problem;
  }

  get code(): string {
    return this.problem?.code ?? "";
  }

  get field(): string | null {
    return this.problem?.field ?? null;
  }

  get errors(): readonly ProblemError[] {
    return this.problem?.errors ?? [];
  }

  get retryAfterSeconds(): number | null {
    const value = this.headers.get("retry-after");
    if (!value) return null;
    if (/^\d+$/.test(value)) return Number(value);
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
}

export class ValidationError extends ApiError {}
export class AuthenticationError extends ApiError {}
export class NotFoundError extends ApiError {}
export class ConflictError extends ApiError {}
export class GoneError extends ApiError {}
export class RateLimitError extends ApiError {}
export class ServerError extends ApiError {}
export class UnavailableError extends ServerError {}

export function apiErrorFromResponse(status: number, body: string, headers: Headers): ApiError {
  if (status === 400) return new ValidationError(status, body, headers);
  if (status === 401 || status === 403) return new AuthenticationError(status, body, headers);
  if (status === 404) return new NotFoundError(status, body, headers);
  if (status === 409) return new ConflictError(status, body, headers);
  if (status === 410) return new GoneError(status, body, headers);
  if (status === 429) return new RateLimitError(status, body, headers);
  if (status === 503) return new UnavailableError(status, body, headers);
  if (status >= 500) return new ServerError(status, body, headers);
  return new ApiError(status, body, headers);
}

function parseProblem(status: number, body: string): ProblemDetails | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== "object") return null;
    const problem = fromWire<ProblemDetails>(parsed);
    return typeof problem.type === "string"
      && typeof problem.title === "string"
      && typeof problem.status === "number"
      && Number.isInteger(problem.status)
      && problem.status === status
      && typeof problem.detail === "string"
      && typeof problem.code === "string"
      ? problem
      : null;
  } catch {
    return null;
  }
}
