import { createHmac, timingSafeEqual } from "node:crypto";
import { SignatureMismatchError, TimestampSkewError } from "./errors.js";
import type { WebhookEvent } from "./types.js";
import { fromWire } from "./wire.js";

export class WebhookVerifier {
  constructor(
    private readonly secret: string,
    private readonly toleranceSeconds = 300,
  ) {
    if (typeof secret !== "string" || secret.trim() === "") {
      throw new TypeError("Webhook secret must be a non-empty string.");
    }
    if (!Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 0) {
      throw new TypeError("Webhook tolerance must be a non-negative integer.");
    }
  }

  verify(signatureHeader: string, rawBody: string | Buffer, now = Math.floor(Date.now() / 1000)): boolean {
    try {
      this.assertValid(signatureHeader, rawBody, now);
      return true;
    } catch {
      return false;
    }
  }

  assertValid(signatureHeader: string, rawBody: string | Buffer, now = Math.floor(Date.now() / 1000)): void {
    const parsed = parseHeader(signatureHeader);
    if (!parsed) throw new SignatureMismatchError("Webhook signature header is missing or malformed.");
    if (Math.abs(now - parsed.timestamp) > this.toleranceSeconds) {
      throw new TimestampSkewError("Webhook timestamp is outside the allowed tolerance.");
    }

    const expected = createHmac("sha256", this.secret)
      .update(`${parsed.timestamp}.`)
      .update(rawBody)
      .digest();
    const matched = parsed.signatures.some((signature) => {
      if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false;
      const candidate = Buffer.from(signature, "hex");
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    });
    if (!matched) throw new SignatureMismatchError("Webhook signature does not match payload.");
  }

  constructEvent<T = unknown>(
    signatureHeader: string,
    rawBody: string | Buffer,
    now = Math.floor(Date.now() / 1000),
  ): WebhookEvent<T> {
    this.assertValid(signatureHeader, rawBody, now);
    try {
      const event = fromWire<unknown>(JSON.parse(rawBody.toString()));
      assertEventEnvelope(event);
      return event as WebhookEvent<T>;
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError("Webhook payload is not valid JSON.", { cause: error });
    }
  }
}

function parseHeader(header: string): { timestamp: number; signatures: string[] } | null {
  if (typeof header !== "string") return null;
  let timestamp: number | undefined;
  let timestampCount = 0;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) {
      timestamp = Number(value);
      timestampCount += 1;
    }
    if (key === "v1" && value !== "") signatures.push(value);
  }
  return timestamp === undefined || timestampCount !== 1 || !Number.isSafeInteger(timestamp) || signatures.length === 0
    ? null
    : { timestamp, signatures };
}

function assertEventEnvelope(value: unknown): asserts value is WebhookEvent<unknown> {
  if (value === null || typeof value !== "object") throw new TypeError("Webhook payload must be an object.");
  const event = value as Record<string, unknown>;
  if (typeof event.eventId !== "string" || event.eventId.trim() === "") {
    throw new TypeError("Webhook eventId must be a non-empty string.");
  }
  if (typeof event.eventType !== "string" || event.eventType.trim() === "") {
    throw new TypeError("Webhook eventType must be a non-empty string.");
  }
  if (!Number.isSafeInteger(event.version) || (event.version as number) < 1) {
    throw new TypeError("Webhook version must be a positive integer.");
  }
  if (!Number.isSafeInteger(event.occurredAt) || (event.occurredAt as number) < 0) {
    throw new TypeError("Webhook occurredAt must be a non-negative Unix timestamp.");
  }
  if (event.data === null || typeof event.data !== "object") {
    throw new TypeError("Webhook data must be an object.");
  }
}
