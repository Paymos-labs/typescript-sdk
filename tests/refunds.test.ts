import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ConflictError,
  NotFoundError,
  Paymos,
  PaymosError,
  ValidationError,
  type Refund,
  type RefundListPage,
  type RefundMode,
} from "../src/index.js";

interface RequestVector {
  method: string;
  path: string;
  body: { invoice_id: string; mode: RefundMode; external_order_id: string };
}

const { vectors } = JSON.parse(
  readFileSync(new URL("../conformance/contract.json", import.meta.url), "utf8"),
) as {
  vectors: {
    refunds: {
      create: RequestVector & {
        new_status: number;
        replay_status: number;
        changed_mode_status: number;
        rejected_fields: string[];
      };
      overpayment: RequestVector;
      list: { path: string; page_sizes: number[]; invalid_cursor_status: number };
      get: { path: string; foreign_or_missing_status: number };
    };
    problem_details: { multi: { errors: { code: string; field: string; message: string }[] } };
  };
};
const refunds = vectors.refunds;

const REFUND = {
  withdrawal_id: "wdr_1",
  invoice_id: "inv_74BPZFhr9qy9Uz2fbRkdJX",
  mode: "full",
  external_order_id: "refund-order-1",
  status: "created",
  is_final: false,
  is_test: true,
  amount: "120",
  currency: "USDT",
  network: "TRC20",
  destination_address: "TFirstSender",
  first_sender: "TFirstSender",
  created_at: 1_700_000_000,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
  });
}

function paymos(fetchMock: typeof globalThis.fetch): Paymos {
  return new Paymos({
    apiKey: "pk_test_key",
    apiSecret: "sk_test_secret",
    fetch: fetchMock,
    clock: () => 1_700_000_000_000,
  });
}

function expectRequest(
  [url, init]: Parameters<typeof fetch>,
  method: string,
  path: string,
  body = "",
  query = "",
): void {
  expect(url).toBe(`https://api.paymos.io${path}${query}`);
  expect(init?.method).toBe(method);
  expect(init?.body ?? "").toBe(body);
  const hash = body === "" ? "" : createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", "sk_test_secret")
    .update(`1700000000\n${method}\n${path}\n${query}\n${hash}`)
    .digest("base64");
  const headers = new Headers(init?.headers);
  expect(headers.get("authorization")).toBe(`HMAC-SHA256 pk_test_key:${signature}`);
  expect(headers.get("x-request-timestamp")).toBe("1700000000");
}

describe("refunds", () => {
  it.each(["completed", "failed", "cancelled"])("simulates %s with a signed refund route and preserves metadata", async (status) => {
    const address = "UQDKbjIcfM6ezt8KjKJJLshZJJSqX7XOA4ff-W72r5gqPuwA";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({
      ...REFUND, status, is_final: true, network: "TON", destination_address: address,
      first_sender: address, type: "refund", project_id: "prj_1",
    }));
    const result = await paymos(fetchMock).refunds.simulate("wdr/1 ?", status);
    expect(result.status).toBe(status);
    expect(result.destinationAddress).toBe(address);
    expect(result.firstSender).toBe(address);
    expect(result.type).toBe("refund");
    expect(result.projectId).toBe("prj_1");
    expectRequest(fetchMock.mock.calls[0]!, "POST", "/v1/sandbox/refunds/wdr%2F1%20%3F/simulate", JSON.stringify({ status }));
  });

  it("accepts older refund responses without additive metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json(REFUND));
    const result = await paymos(fetchMock).refunds.get("wdr_1");
    expect(result.type).toBeUndefined();
    expect(result.projectId).toBeUndefined();
  });
  it.each([
    { vector: refunds.create, amount: "120" },
    { vector: refunds.overpayment, amount: "20" },
  ])("creates $vector.body.mode with only invoice, mode and key signed by HMAC", async ({ vector, amount }) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({
      ...REFUND,
      ...vector.body,
      amount,
    }, refunds.create.new_status));
    const client = paymos(fetchMock);

    const refund = await client.refunds.create(
      vector.body.invoice_id,
      vector.body.mode,
      vector.body.external_order_id,
    );

    expectRequest(fetchMock.mock.calls[0]!, vector.method, vector.path, JSON.stringify(vector.body));
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    for (const field of refunds.create.rejected_fields) expect(sent).not.toHaveProperty(field);
    expect(refund).toMatchObject({
      withdrawalId: "wdr_1",
      invoiceId: REFUND.invoice_id,
      externalOrderId: vector.body.external_order_id,
      mode: vector.body.mode,
      amount,
      firstSender: "TFirstSender",
      createdAt: 1_700_000_000,
    });
  });

  it("returns the same withdrawal for a 201 create and its 200 replay", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(REFUND, refunds.create.new_status))
      .mockResolvedValueOnce(json(REFUND, refunds.create.replay_status));
    const client = paymos(fetchMock);

    const created = await client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id);
    const replayed = await client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id);

    expect(replayed).toEqual(created);
    expect(replayed.withdrawalId).toBe("wdr_1");
    for (const call of fetchMock.mock.calls) {
      expectRequest(call, "POST", refunds.create.path, JSON.stringify(refunds.create.body));
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a changed-mode 409 structured and does not send a new key", async () => {
    const problem = {
      type: "about:blank",
      title: "Conflict",
      status: refunds.create.changed_mode_status,
      detail: "This refund key is already bound to another mode.",
      code: "idempotency_conflict",
      field: "external_order_id",
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(REFUND, 201))
      .mockResolvedValueOnce(json(problem, problem.status));
    const client = paymos(fetchMock);
    await client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id);

    const error = await client.refunds.create(REFUND.invoice_id, "overpayment", REFUND.external_order_id)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ status: 409, code: "idempotency_conflict", field: "external_order_id", problem });
    expectRequest(fetchMock.mock.calls[1]!, "POST", refunds.create.path, JSON.stringify({
      invoice_id: REFUND.invoice_id,
      mode: "overpayment",
      external_order_id: REFUND.external_order_id,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves an unknown outcome to an explicit replay with the same mode and key", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Connection lost after send"))
      .mockResolvedValueOnce(json(REFUND, refunds.create.replay_status));
    const client = paymos(fetchMock);

    await expect(client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id))
      .rejects.toBeInstanceOf(PaymosError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const replayed = await client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id);

    expect(replayed.withdrawalId).toBe("wdr_1");
    for (const call of fetchMock.mock.calls) {
      expectRequest(call, "POST", refunds.create.path, JSON.stringify(refunds.create.body));
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads server amounts for sandbox paid 120 / expected 100, overpayment 20, then full 100", async () => {
    const overpayment = {
      ...REFUND,
      mode: "overpayment",
      external_order_id: "refund-order-2",
      amount: "20",
    };
    const completed = { ...overpayment, status: "completed", is_final: true, completed_at: 1_700_000_100 };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({
        invoice_id: REFUND.invoice_id,
        status: "paid_over",
        is_test: true,
        payment: { expected: "100", paid: "120", currency: "USDT", network: "TRC20" },
      }))
      .mockResolvedValueOnce(json(overpayment, 201))
      .mockResolvedValueOnce(json(completed))
      .mockResolvedValueOnce(json(completed))
      .mockResolvedValueOnce(json({ ...REFUND, withdrawal_id: "wdr_2", amount: "100" }, 201));
    const client = paymos(fetchMock);

    const invoice = await client.invoices.simulatePayment(REFUND.invoice_id, "overpaid");
    const over = await client.refunds.create(invoice.invoiceId, "overpayment", "refund-order-2");
    await client.withdrawals.simulateCompletion(over.withdrawalId);
    const settled = await client.refunds.get(over.withdrawalId);
    const full = await client.refunds.create(invoice.invoiceId, "full", "refund-order-1");

    expect(invoice.payment).toMatchObject({ expected: "100", paid: "120" });
    expect(over).toMatchObject({ amount: "20", mode: "overpayment", isTest: true, status: "created" });
    expect(settled).toMatchObject({ status: "completed", amount: "20", completedAt: 1_700_000_100 });
    expect(full).toMatchObject({ withdrawalId: "wdr_2", mode: "full", amount: "100", isTest: true });
    expectRequest(fetchMock.mock.calls[0]!, "POST", `/v1/sandbox/invoices/${REFUND.invoice_id}/simulate-payment`,
      JSON.stringify({ stage: "overpaid" }));
    expectRequest(fetchMock.mock.calls[1]!, "POST", refunds.overpayment.path, JSON.stringify(refunds.overpayment.body));
    expectRequest(fetchMock.mock.calls[2]!, "POST", "/v1/sandbox/withdrawals/wdr_1/simulate-completion");
    expectRequest(fetchMock.mock.calls[3]!, "GET", "/v1/refunds/wdr_1");
    expectRequest(fetchMock.mock.calls[4]!, "POST", refunds.create.path, JSON.stringify(refunds.create.body));
  });

  it("signs invoice, repeated status, RFC 3339 period and opaque cursor filters", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ items: [REFUND], next_cursor: "next/2+=" }));
    const client = paymos(fetchMock);

    const page = await client.refunds.list({
      invoiceId: REFUND.invoice_id,
      status: ["pending_review", "created"],
      createdFrom: "2026-10-01T00:00:00+03:00",
      createdTo: "2026-11-01T00:00:00Z",
      cursor: "cur_(1)*",
      limit: 100,
    });

    const query = "?created_from=2026-10-01T00%3A00%3A00%2B03%3A00" +
      "&created_to=2026-11-01T00%3A00%3A00Z&cursor=cur_%281%29%2A" +
      `&invoice_id=${REFUND.invoice_id}&limit=100&status=created&status=pending_review`;
    expectRequest(fetchMock.mock.calls[0]!, "GET", refunds.list.path, "", query);
    expect(page.items[0]).toMatchObject({ withdrawalId: "wdr_1", amount: "120", firstSender: "TFirstSender" });
    expect(page.nextCursor).toBe("next/2+=");
  });

  it("reads all 205 refunds through the shared 100 / 100 / 5 cursor vector", async () => {
    let offset = 0;
    const pages = refunds.list.page_sizes.map((size, index) => {
      const items = Array.from({ length: size }, () => ({ ...REFUND, withdrawal_id: `wdr_${++offset}` }));
      return { items, next_cursor: index < 2 ? `cur_${index + 1}` : null };
    });
    const fetchMock = vi.fn<typeof fetch>();
    for (const page of pages) fetchMock.mockResolvedValueOnce(json(page));
    const client = paymos(fetchMock);
    const ids: string[] = [];
    let cursor: string | null = null;

    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const page: RefundListPage = await client.refunds.list({
        invoiceId: REFUND.invoice_id,
        limit: 100,
        ...(cursor === null ? {} : { cursor }),
      });
      expect(page.items).toHaveLength(refunds.list.page_sizes[pageIndex]!);
      ids.push(...page.items.map((item) => item.withdrawalId));
      const query = `${cursor === null ? "?" : `?cursor=${cursor}&`}invoice_id=${REFUND.invoice_id}&limit=100`;
      expectRequest(fetchMock.mock.calls[pageIndex]!, "GET", refunds.list.path, "", query);
      cursor = page.nextCursor;
    }

    expect(ids).toHaveLength(205);
    expect(new Set(ids).size).toBe(205);
    expect(ids[0]).toBe("wdr_1");
    expect(ids[204]).toBe("wdr_205");
    expect(cursor).toBeNull();
  });

  it("allows an unfiltered empty page", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ items: [], next_cursor: null }));
    const client = paymos(fetchMock);

    await expect(client.refunds.list()).resolves.toEqual({ items: [], nextCursor: null });

    expectRequest(fetchMock.mock.calls[0]!, "GET", refunds.list.path);
  });

  it("gets a withdrawal id as one encoded path segment and preserves decimal precision", async () => {
    const amount = "9007199254740993.123456789012345678";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({
      ...REFUND,
      amount,
      fee: "0.000000000000000001",
      tx_hash: "refund_tx",
      explorer_url: "https://tronscan.org/#/transaction/refund_tx",
    }));
    const client = paymos(fetchMock);

    const refund = await client.refunds.get("wdr/1*(x)");

    expectRequest(fetchMock.mock.calls[0]!, "GET", refunds.get.path.replace("{id}", "wdr%2F1%2A%28x%29"));
    expect(refund).toMatchObject({
      withdrawalId: "wdr_1",
      invoiceId: REFUND.invoice_id,
      amount,
      fee: "0.000000000000000001",
      currency: "USDT",
      network: "TRC20",
      destinationAddress: "TFirstSender",
      firstSender: "TFirstSender",
      txHash: "refund_tx",
      explorerUrl: "https://tronscan.org/#/transaction/refund_tx",
    });
    expectTypeOf(refund.amount).toEqualTypeOf<string>();
    expectTypeOf(refund.fee).toEqualTypeOf<string | undefined>();
  });

  it.each(["wdr_foreign", "wdr_missing"])("returns structured 404 for %s", async (id) => {
    const problem = {
      type: "about:blank",
      title: "Not Found",
      status: refunds.get.foreign_or_missing_status,
      detail: "Refund not found.",
      code: "withdrawal_not_found",
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json(problem, problem.status));
    const client = paymos(fetchMock);

    const error = await client.refunds.get(id).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ status: 404, code: "withdrawal_not_found", field: null, problem });
    expectRequest(fetchMock.mock.calls[0]!, "GET", refunds.get.path.replace("{id}", id));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a structured invalid-cursor error", async () => {
    const problem = {
      type: "about:blank",
      title: "Bad Request",
      status: refunds.list.invalid_cursor_status,
      detail: "Invalid cursor.",
      code: "pagination_cursor_invalid",
      field: "cursor",
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json(problem, problem.status));
    const client = paymos(fetchMock);

    const error = await client.refunds.list({ cursor: "invalid" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ status: 400, code: "pagination_cursor_invalid", field: "cursor", problem });
    expectRequest(fetchMock.mock.calls[0]!, "GET", refunds.list.path, "", "?cursor=invalid");
  });

  it("keeps the top-level RFC 9457 code and every validation error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json(vectors.problem_details.multi, 400));
    const client = paymos(fetchMock);

    const error = await client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({
      status: 400,
      code: "validation_failed",
      field: null,
      problem: vectors.problem_details.multi,
      errors: vectors.problem_details.multi.errors,
    });
  });

  it("exposes readonly refund responses and no client-controlled amount arguments", () => {
    const client = paymos(vi.fn<typeof fetch>());
    if (false) {
      const refund = {} as Refund;
      const page = {} as RefundListPage;
      // @ts-expect-error Refund amounts are read-only.
      refund.amount = "1";
      // @ts-expect-error Refund modes are read-only.
      refund.mode = "overpayment";
      // @ts-expect-error The server chooses the destination.
      refund.destinationAddress = "another sender";
      // @ts-expect-error Refund page items are read-only.
      page.items.push(refund);
      // @ts-expect-error Refund cursors are read-only.
      page.nextCursor = "another cursor";
      // @ts-expect-error Only full and overpayment modes exist.
      void client.refunds.create("inv_1", "partial", "refund_1");
      // @ts-expect-error Create has no amount argument.
      void client.refunds.create("inv_1", "full", "refund_1", "10");
      // @ts-expect-error Create accepts invoice, mode and key, without a money payload.
      void client.refunds.create({ invoiceId: "inv_1", amount: "10", currency: "USDT", network: "TRC20" });
      // @ts-expect-error Refund periods use RFC 3339 strings.
      void client.refunds.list({ createdFrom: 1_700_000_000 });
    }
    expectTypeOf(client.refunds.create).returns.toEqualTypeOf<Promise<Refund>>();
  });
});
