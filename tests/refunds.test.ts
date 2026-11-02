import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ConfigurationError,
  ConflictError,
  NotFoundError,
  Paymos,
  PaymosError,
  RateLimitError,
  UnavailableError,
  ValidationError,
  type Refund,
  type RefundListPage,
  type RefundMode,
} from "../src/index.js";

afterEach(() => vi.unstubAllGlobals());

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

it.each(["completed", "failed", "cancelled"] as const)("simulates a scoped refund as %s", async (status) => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...REFUND, status }));
  const result = await paymos(fetchMock).refunds.simulate("wdr /?", status);
  expect(result.status).toBe(status);
  expectRequest(fetchMock.mock.calls[0]!, "POST", "/v1/sandbox/refunds/wdr%20%2F%3F/simulate", JSON.stringify({ status }));
});

const REFUND = {
  type: "refund",
  project_id: "prj_test",
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
  vi.stubGlobal("fetch", fetchMock);
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
  it.each([
    { vector: refunds.create, amount: "120" },
    { vector: refunds.overpayment, amount: "20" },
  ])("OFF rejects $vector.body.mode before sending the original invoice and key", async ({ vector, amount }) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({
      ...REFUND,
      ...vector.body,
      amount,
    }, refunds.create.new_status));
    const client = paymos(fetchMock);
    await expect(client.refunds.create(vector.body.invoice_id, vector.body.mode, vector.body.external_order_id))
      .rejects.toBeInstanceOf(ConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OFF rejects create and the explicit same-key replay before sending", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(REFUND, refunds.create.new_status))
      .mockResolvedValueOnce(json(REFUND, refunds.create.replay_status));
    const client = paymos(fetchMock);
    for (let i = 0; i < 2; i++) {
      await expect(client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id))
        .rejects.toBeInstanceOf(ConfigurationError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OFF rejects both modes for an existing key before sending", async () => {
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
    for (const mode of ["full", "overpayment"] as const) {
      await expect(client.refunds.create(REFUND.invoice_id, mode, REFUND.external_order_id))
        .rejects.toBeInstanceOf(ConfigurationError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OFF rejects retry-configured create and explicit replay before sending", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ type: "about:blank", title: "Rate limited", status: 429,
        detail: "Try later", code: "rate_limited" }, 429))
      .mockResolvedValueOnce(json(REFUND, 201));
    vi.stubGlobal("fetch", fetchMock);
    const client = new Paymos({ apiKey: "pk_test_key", apiSecret: "sk_test_secret", fetch: fetchMock,
      clock: () => 1_700_000_000_000, retry: { maxRetries: 2, baseDelayMs: 0 } });
    for (let i = 0; i < 2; i++) {
      await expect(client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id))
        .rejects.toBeInstanceOf(ConfigurationError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OFF rejects refund before any unavailable response or retry", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(json(REFUND, 201));
    const client = paymos(fetchMock);
    await expect(client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id))
      .rejects.toBeInstanceOf(ConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps ordinary invoice POST and GET retries", async () => {
    const post = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({}, 201));
    const client = new Paymos({ apiKey: "pk_test_key", apiSecret: "sk_test_secret", fetch: post,
      retry: { maxRetries: 1, baseDelayMs: 0 } });
    await client.invoices.create({ projectId: "prj_1", amount: "1", currency: "USD", externalOrderId: "order_1" });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]?.[1]?.body).toBe(post.mock.calls[1]?.[1]?.body);
    const get = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({}, 200));
    const other = new Paymos({ apiKey: "pk_test_key", apiSecret: "sk_test_secret", fetch: get,
      retry: { maxRetries: 1, baseDelayMs: 0 } });
    await other.invoices.get("inv_1");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("OFF rejects create and replay before an outcome can become unknown", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Connection lost after send"))
      .mockResolvedValueOnce(json(REFUND, refunds.create.replay_status));
    const client = paymos(fetchMock);
    for (let i = 0; i < 2; i++) {
      await expect(client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id))
        .rejects.toBeInstanceOf(ConfigurationError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OFF keeps sandbox invoice simulation but rejects refund creation", async () => {
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
    expect(invoice.payment).toMatchObject({ expected: "100", paid: "120" });
    expectRequest(fetchMock.mock.calls[0]!, "POST", `/v1/sandbox/invoices/${REFUND.invoice_id}/simulate-payment`,
      JSON.stringify({ stage: "overpaid" }));
    await expect(client.refunds.create(invoice.invoiceId, "overpayment", "refund-order-2"))
      .rejects.toBeInstanceOf(ConfigurationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("OFF preserves RFC 9457 validation errors for history reads", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json(vectors.problem_details.multi, 400));
    const client = paymos(fetchMock);
    await expect(client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id))
      .rejects.toBeInstanceOf(ConfigurationError);
    const error = await client.refunds.get("wdr_fake").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ status: 400, code: "validation_failed", field: null,
      problem: vectors.problem_details.multi, errors: vectors.problem_details.multi.errors });
    expectRequest(fetchMock.mock.calls[0]!, "GET", "/v1/refunds/wdr_fake");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

// The dispatcher is an in-memory receiver. Native Node fetch still performs all redirect logic;
// the test never opens a socket and never calls an actual API host.
import { HttpClient as RedirectProbeHttpClient } from "../src/http.js";

type RedirectProbeHandler = {
  onConnect(abort: () => void, context: unknown): void;
  onHeaders(status: number, headers: Buffer[], resume: () => void, message: string): boolean;
  onData(chunk: Buffer): boolean;
  onComplete(trailers: Buffer[]): void;
  onError(error: Error): void;
};

function redirectProbe(status: number) {
  const calls: { method: string; path: string; body: string }[] = [];
  const dispatcher = {
    dispatch(options: { method: string; path: string; body?: unknown }, handler: RedirectProbeHandler): boolean {
      let aborted = false;
      handler.onConnect(() => { aborted = true; }, null);
      void (async () => {
        let body = "";
        const input = options.body;
        if (typeof input === "string") body = input;
        else if (input instanceof Uint8Array) body = Buffer.from(input).toString("utf8");
        else if (input && Symbol.asyncIterator in Object(input)) {
          const chunks: Buffer[] = [];
          for await (const chunk of input as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
          body = Buffer.concat(chunks).toString("utf8");
        }
        calls.push({ method: options.method, path: options.path, body });
        if (aborted) return;
        if (calls.length === 1) {
          handler.onHeaders(status, [Buffer.from("location"), Buffer.from("/redirected")], () => {}, "Redirect");
        } else {
          const response = Buffer.from('{"withdrawal_id":"wdr_fake"}');
          handler.onHeaders(200, [Buffer.from("content-type"), Buffer.from("application/json")], () => {}, "OK");
          handler.onData(response);
        }
        if (!aborted) handler.onComplete([]);
      })().catch((error: unknown) => handler.onError(error instanceof Error ? error : new Error(String(error))));
      return true;
    },
  };
  const nativeFetch = globalThis.fetch;
  const wrappedFetch: typeof globalThis.fetch = (input, init) =>
    nativeFetch(input, { ...init, dispatcher } as RequestInit);
  return { calls, fetch: wrappedFetch };
}

describe("standard fetch refund redirects", () => {
  it.each([301, 302, 303, 307, 308])("OFF rejects refund before a %s redirect can be sent", async (status) => {
    const probe = redirectProbe(status);
    vi.stubGlobal("fetch", probe.fetch);
    const client = new RedirectProbeHttpClient({
      apiKey: "pk_test", apiSecret: "sk_test", baseUrl: "https://refund.invalid",
      fetch: probe.fetch, retry: false, clock: () => 1_700_000_000_000,
    });
    await expect(client.request("POST", "/v1/refunds", {
      invoiceId: "inv_fake", mode: "full", externalOrderId: "original-key",
    })).rejects.toBeInstanceOf(ConfigurationError);
    expect(probe.calls).toEqual([]);
  });

  it("preserves ordinary invoice redirects", async () => {
    const probe = redirectProbe(307);
    vi.stubGlobal("fetch", probe.fetch);
    const client = new RedirectProbeHttpClient({
      apiKey: "pk_test", apiSecret: "sk_test", baseUrl: "https://refund.invalid",
      fetch: probe.fetch, retry: false, clock: () => 1_700_000_000_000,
    });
    await expect(client.request("POST", "/v1/invoices", { externalOrderId: "invoice-key" }))
      .resolves.toMatchObject({ withdrawalId: "wdr_fake" });
    expect(probe.calls.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "POST", path: "/v1/invoices" },
      { method: "POST", path: "/redirected" },
    ]);
  });
});

it.each([307, 308])("OFF rejects refund before a %s redirect or replay", async (status) => {
  const probe = redirectProbe(status);
  vi.stubGlobal("fetch", probe.fetch);
  const client = new RedirectProbeHttpClient({
    apiKey: "pk_test", apiSecret: "sk_test", baseUrl: "https://refund.invalid",
    fetch: probe.fetch, retry: false, clock: () => 1_700_000_000_000,
  });
  await expect(client.request("POST", "/v1/refunds", {
    invoiceId: "inv_fake", mode: "full", externalOrderId: "original-key",
  })).rejects.toBeInstanceOf(ConfigurationError);
  expect(probe.calls).toEqual([]);
});

it("OFF rejects before a redirected custom Fetch response", async () => {
  const response = new Response('{"withdrawal_id":"wdr_fake"}', { status: 200 });
  Object.defineProperty(response, "redirected", { value: true });
  const customFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", customFetch);
  const client = new RedirectProbeHttpClient({
    apiKey: "pk_test", apiSecret: "sk_test", fetch: customFetch, retry: false,
  });
  await expect(client.request("POST", "/v1/refunds", {
    invoiceId: "inv_fake", mode: "full", externalOrderId: "original-key",
  })).rejects.toBeInstanceOf(ConfigurationError);
  expect(customFetch).not.toHaveBeenCalled();
});

it("continues accepting redirected responses for ordinary invoice operations", async () => {
  const response = new Response('{"invoice_id":"inv_fake"}', { status: 200 });
  Object.defineProperty(response, "redirected", { value: true });
  const customFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", customFetch);
  const client = new RedirectProbeHttpClient({
    apiKey: "pk_test", apiSecret: "sk_test", fetch: customFetch, retry: false,
  });
  await expect(client.request("POST", "/v1/invoices", { externalOrderId: "invoice-key" }))
    .resolves.toMatchObject({ invoiceId: "inv_fake" });
  expect(customFetch).toHaveBeenCalledTimes(1);
});

it("rejects an unverified custom fetch before refund create but preserves ordinary and history reads", async () => {
  const customFetch = vi.fn<typeof fetch>().mockImplementation(async () => json(REFUND));
  const client = new Paymos({ apiKey: "pk_test", apiSecret: "sk_test", fetch: customFetch, retry: false });

  await expect(client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id))
    .rejects.toBeInstanceOf(ConfigurationError);
  expect(customFetch).not.toHaveBeenCalled();

  await client.invoices.get("inv_1");
  await client.refunds.get("wdr_1");
  expect(customFetch).toHaveBeenCalledTimes(2);
});

type Ir52Internals = { http: { options: { fetch: typeof globalThis.fetch } } };

function ir52ReplaceFetch(client: Paymos, fetchImplementation: typeof globalThis.fetch): void {
  (client.refunds as unknown as Ir52Internals).http.options.fetch = fetchImplementation;
}

it("IR-52 rejects a constructor fetch getter that first returns an unverified transport", async () => {
  const custom = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  let reads = 0;
  const client = new Paymos({
    apiKey: "pk_test", apiSecret: "sk_test",
    get fetch() { reads += 1; return reads === 1 ? custom : globalThis.fetch; },
  });

  await expect(client.refunds.create("inv_test", "full", "original-key")).rejects.toBeInstanceOf(ConfigurationError);
  expect(reads).toBe(1);
  expect(custom).not.toHaveBeenCalled();
});

it("OFF rejects even when the first getter yields the ambient Fetch", async () => {
  const standard = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  const custom = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  vi.stubGlobal("fetch", standard);
  let reads = 0;
  const client = new Paymos({
    apiKey: "pk_test", apiSecret: "sk_test",
    get fetch() { reads += 1; return reads === 1 ? standard : custom; },
  });
  await expect(client.refunds.create("inv_test", "full", "original-key")).rejects.toBeInstanceOf(ConfigurationError);
  expect(reads).toBe(1);
  expect(standard).not.toHaveBeenCalled();
  expect(custom).not.toHaveBeenCalled();
});

it("OFF rejects even when the getter yields the default Fetch", async () => {
  const standard = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  const custom = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  vi.stubGlobal("fetch", standard);
  let reads = 0;
  const options = {
    apiKey: "pk_test", apiSecret: "sk_test",
    get fetch() { reads += 1; return reads === 1 ? undefined : custom; },
  } as unknown as ConstructorParameters<typeof Paymos>[0];
  await expect(new Paymos(options).refunds.create("inv_test", "full", "original-key"))
    .rejects.toBeInstanceOf(ConfigurationError);
  expect(reads).toBe(1);
  expect(standard).not.toHaveBeenCalled();
  expect(custom).not.toHaveBeenCalled();
});

it("IR-52 rejects an unverified fetch substituted after client construction", async () => {
  const custom = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  const client = new Paymos({ apiKey: "pk_test", apiSecret: "sk_test" });
  ir52ReplaceFetch(client, custom);

  await expect(client.refunds.create("inv_test", "full", "original-key")).rejects.toBeInstanceOf(ConfigurationError);
  expect(custom).not.toHaveBeenCalled();
});

it("OFF rejects before a clock callback can alter Fetch", async () => {
  const standard = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  const custom = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  vi.stubGlobal("fetch", standard);
  let client!: Paymos;
  client = new Paymos({
    apiKey: "pk_test", apiSecret: "sk_test",
    clock: () => { ir52ReplaceFetch(client, custom); return 1_700_000_000_000; },
  });
  await expect(client.refunds.create("inv_test", "full", "original-key")).rejects.toBeInstanceOf(ConfigurationError);
  expect(standard).not.toHaveBeenCalled();
  expect(custom).not.toHaveBeenCalled();
});
