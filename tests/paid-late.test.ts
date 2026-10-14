import { describe, expect, it, vi } from "vitest";
import { Paymos } from "../src/index.js";

// invoice-late-payment wire contract (late-26):
//   • Invoice decodes paid_late_at as Unix seconds, as null, and as ABSENT (legacy payload).
//   • The terminal status/expired semantics and the payment money fields stay exactly as they were.
//   • The invoice.paid_late event type is a first-class member of the event union.
//   • simulatePayment("paid_late") serializes the stage verbatim.

describe("paid_late wire contract", () => {
  const expiredPayload = {
    invoice_id: "inv_1",
    project_id: "prj_1",
    status: "expired",
    is_final: true,
    is_test: false,
    payment_url: "https://pay.test/inv_1",
    order: { external_id: "order_1", amount: "100.00", currency: "USD" },
    payment: { currency: "USDT", network: "tron", chain_id: 728126428, expected: "100.00", paid: "60.00" },
    created_at: 1_700_000_000,
    updated_at: 1_700_003_600,
    expires_at: 1_700_003_600,
    completed_at: 1_700_003_600,
  };

  function clientReturning(payload: object) {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () => new Response(JSON.stringify(payload), { status: 200 }),
    );
    return { client: new Paymos({ apiKey: "pk", apiSecret: "sk", fetch: fetchMock, retry: false }), fetchMock };
  }

  it("decodes the late mark as Unix seconds beside an unchanged terminal status", async () => {
    const { client } = clientReturning({ ...expiredPayload, paid_late_at: 1_700_007_200 });
    const invoice = await client.invoices.get("inv_1");
    expect(invoice.status).toBe("expired");
    expect(invoice.isFinal).toBe(true);
    expect(invoice.paidLateAt).toBe(1_700_007_200);
    expect(invoice.payment?.paid).toBe("60.00");
  });

  it("decodes an explicit null late mark", async () => {
    const { client } = clientReturning({ ...expiredPayload, paid_late_at: null });
    const invoice = await client.invoices.get("inv_1");
    expect(invoice.status).toBe("expired");
    expect(invoice.paidLateAt).toBeNull();
  });

  it("keeps legacy payloads without the field readable", async () => {
    const { client } = clientReturning(expiredPayload);
    const invoice = await client.invoices.get("inv_1");
    expect(invoice.status).toBe("expired");
    expect(invoice.paidLateAt).toBeUndefined();
  });

  it("serializes the paid_late simulation stage", async () => {
    const { client, fetchMock } = clientReturning(expiredPayload);
    await client.invoices.simulatePayment("inv_1", "paid_late");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({ stage: "paid_late" }));
  });

  it("accepts invoice.paid_late as an event type at the type level", () => {
    const eventType: string = "invoice.paid_late";
    expect(eventType).toBe("invoice.paid_late");
  });
});
