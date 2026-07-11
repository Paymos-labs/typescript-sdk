import { createHmac, timingSafeEqual } from "node:crypto";
import { SignatureMismatchError, TimestampSkewError } from "./errors.js";
import type { WebhookEvent } from "./types.js";

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
      return JSON.parse(rawBody.toString()) as WebhookEvent<T>;
    } catch (error) {
      throw new TypeError("Webhook payload is not valid JSON.", { cause: error });
    }
  }
}

function parseHeader(header: string): { timestamp: number; signatures: string[] } | null {
  if (typeof header !== "string") return null;
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && value !== "") signatures.push(value);
  }
  return timestamp === undefined || signatures.length === 0 ? null : { timestamp, signatures };
}
