import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PaymentChannelDeposit, Withdrawal, WithdrawalEventType } from "../src/index.js";
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

  /**
   * The deposit wire shape doubles as the webhook payload, so the same model the feed
   * decodes must survive `constructEvent`. This is a native-TRX deposit: it has no
   * contract, the payer address was not attributable, and no explorer link was minted —
   * those keys are ABSENT from the JSON, not null, and must stay absent after decoding.
   */
  it("round-trips a payment_channel.deposit.confirmed body into the deposit model", () => {
    const depositBody = JSON.stringify({
      event_id: "evt_2",
      event_type: "payment_channel.deposit.confirmed",
      version: 1,
      occurred_at: timestamp,
      data: {
        id: "pcd_9",
        payment_channel_id: "pc_1",
        project_id: "prj_1",
        payment_channel_external_id: "customer-42",
        status: "confirmed",
        is_final: true,
        is_test: false,
        currency: "TRX",
        network: "TRC20",
        chain_id: 728_126_428,
        gross: "100.00",
        fee: "1.00",
        net: "99.00",
        applied_fee_percent: 1,
        customer_fee_percent: 0,
        tx_hash: "9a2f1c",
        transfer_id: "trf_1",
        destination_address: "TChannelAddress",
        block_height: 60_000_000,
        created_at: 1_700_000_000,
        updated_at: 1_700_000_100,
        confirmed_at: 1_700_000_100,
      },
    });
    const signature = createHmac("sha256", secret).update(`${timestamp}.${depositBody}`).digest("hex");

    const event = new WebhookVerifier(secret).constructEvent<PaymentChannelDeposit>(
      `t=${timestamp},v1=${signature}`,
      depositBody,
      timestamp,
    );

    expect(event.eventType).toBe("payment_channel.deposit.confirmed");
    const deposit = event.data;
    expect(deposit.id).toBe("pcd_9");
    expect(deposit.paymentChannelExternalId).toBe("customer-42");
    expect(deposit.isFinal).toBe(true);
    expect(deposit.confirmedAt).toBe(1_700_000_100);

    // Money stays a string all the way through — never a float.
    expect(deposit.gross).toBe("100.00");
    expect(deposit.fee).toBe("1.00");
    expect(deposit.net).toBe("99.00");
    for (const amount of [deposit.gross, deposit.fee, deposit.net]) expect(typeof amount).toBe("string");

    // Absent stays absent: no undefined-valued keys conjured by the case conversion.
    for (const key of ["contractAddress", "sourceAddress", "explorerUrl", "firstIncludedBlockTimestamp"]) {
      expect(deposit).not.toHaveProperty(key);
    }
  });

  /**
   * The named union must list every withdrawal event the server catalog emits
   * (src/Paymos.Domain/Withdrawals/WithdrawalEventTypes.cs). The Record below is a
   * compile-time check run by `npm run check`: a missing union member makes the
   * `withdrawal.completion_rewound` key an excess property, an extra one a missing key.
   */
  it("withdrawal event type includes completion_rewound", () => {
    const serverCatalog: Record<WithdrawalEventType, true> = {
      "withdrawal.created": true,
      "withdrawal.processing": true,
      "withdrawal.completed": true,
      "withdrawal.failed": true,
      "withdrawal.cancelled": true,
      "withdrawal.completion_rewound": true,
    };
    expect(Object.keys(serverCatalog)).toHaveLength(6);

    const rewoundBody = JSON.stringify({
      event_id: "evt_3",
      event_type: "withdrawal.completion_rewound",
      version: 1,
      occurred_at: timestamp,
      data: {
        withdrawal_id: "wd_1",
        external_order_id: "payout_1",
        status: "signed",
        is_final: false,
        is_test: false,
        amount: "50.00",
        currency: "USDT",
        network: "TRC20",
        destination_address: "TDestination",
        created_at: 1_700_000_000,
      },
    });
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rewoundBody}`).digest("hex");

    const event = new WebhookVerifier(secret).constructEvent<Withdrawal>(
      `t=${timestamp},v1=${signature}`,
      rewoundBody,
      timestamp,
    );

    const eventType: WithdrawalEventType = "withdrawal.completion_rewound";
    expect(event.eventType).toBe(eventType);
    expect(event.data.status).toBe("signed");
    expect(event.data.isFinal).toBe(false);
    expect(event.data).not.toHaveProperty("completedAt");
  });
});
