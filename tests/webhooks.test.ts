import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SignatureMismatchError, TimestampSkewError, WebhookVerifier } from "../src/index.js";

describe("WebhookVerifier", () => {
  const timestamp = 1_700_000_000;
  const body = JSON.stringify({
    event_id: "evt_1",
    event_type: "invoice.paid",
    version: 1,
    occurred_at: timestamp,
    data: { invoice_id: "inv_1" },
  });
  const secret = "whsec_test";
  const valid = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

  it("accepts any valid v1 signature during rotation", () => {
    const verifier = new WebhookVerifier(secret);
    expect(verifier.verify(`t=${timestamp},v1=${"0".repeat(64)},v1=${valid}`, body, timestamp)).toBe(true);
    expect(verifier.constructEvent<{ invoiceId: string }>(`t=${timestamp},v1=${valid}`, body, timestamp)).toMatchObject({
      eventId: "evt_1",
      eventType: "invoice.paid",
      occurredAt: timestamp,
      data: { invoiceId: "inv_1" },
    });
  });

  it("rejects invalid signatures and stale timestamps", () => {
    const verifier = new WebhookVerifier(secret, 300);
    expect(() => verifier.assertValid(`t=${timestamp},v1=${"0".repeat(64)}`, body, timestamp)).toThrow(
      SignatureMismatchError,
    );
    expect(() => verifier.assertValid(`t=${timestamp},v1=${valid}`, body, timestamp + 301)).toThrow(
      TimestampSkewError,
    );
  });

  it("rejects ambiguous timestamp headers and malformed verified envelopes", () => {
    const verifier = new WebhookVerifier(secret);
    expect(verifier.verify(`t=${timestamp},t=${timestamp},v1=${valid}`, body, timestamp)).toBe(false);

    const malformed = JSON.stringify({ event_id: "evt_1", event_type: "invoice.paid", data: {} });
    const malformedSignature = createHmac("sha256", secret)
      .update(`${timestamp}.${malformed}`)
      .digest("hex");
    expect(() => verifier.constructEvent(`t=${timestamp},v1=${malformedSignature}`, malformed, timestamp))
      .toThrow("Webhook version");
  });
});
