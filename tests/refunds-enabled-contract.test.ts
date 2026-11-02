/* Archived refund transport cases: deliberately skipped while creation is OFF.
 * Restore only after a verified transport exists. */
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

type Ir52Internals = { http: { options: { fetch: typeof globalThis.fetch } } };

function ir52ReplaceFetch(client: Paymos, fetchImplementation: typeof globalThis.fetch): void {
  (client.refunds as unknown as Ir52Internals).http.options.fetch = fetchImplementation;
}


describe.skip("Refund creation OFF: verified transport and replay remain open", () => {
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

  it("does not automatically retry a rate-limited refund and permits an explicit same-key replay", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ type: "about:blank", title: "Rate limited", status: 429,
        detail: "Try later", code: "rate_limited" }, 429))
      .mockResolvedValueOnce(json(REFUND, 201));
    vi.stubGlobal("fetch", fetchMock);
    const client = new Paymos({ apiKey: "pk_test_key", apiSecret: "sk_test_secret", fetch: fetchMock,
      clock: () => 1_700_000_000_000, retry: { maxRetries: 2, baseDelayMs: 0 } });
    await expect(client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id))
      .rejects.toBeInstanceOf(RateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectRequest(fetchMock.mock.calls[0]!, "POST", refunds.create.path, JSON.stringify(refunds.create.body));
    const result = await client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id);
    expect(result.withdrawalId).toBe("wdr_1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body);
  });

  it("does not automatically retry unavailable refund POSTs", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(json(REFUND, 201));
    const client = paymos(fetchMock);
    await expect(client.refunds.create(REFUND.invoice_id, "full", REFUND.external_order_id))
      .rejects.toBeInstanceOf(UnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectRequest(fetchMock.mock.calls[0]!, "POST", refunds.create.path, JSON.stringify(refunds.create.body));
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
    await client.refunds.simulate(over.withdrawalId, "completed");
    const settled = await client.refunds.get(over.withdrawalId);
    const full = await client.refunds.create(invoice.invoiceId, "full", "refund-order-1");

    expect(invoice.payment).toMatchObject({ expected: "100", paid: "120" });
    expect(over).toMatchObject({ amount: "20", mode: "overpayment", isTest: true, status: "created" });
    expect(settled).toMatchObject({ status: "completed", amount: "20", completedAt: 1_700_000_100 });
    expect(full).toMatchObject({ withdrawalId: "wdr_2", mode: "full", amount: "100", isTest: true });
    expectRequest(fetchMock.mock.calls[0]!, "POST", `/v1/sandbox/invoices/${REFUND.invoice_id}/simulate-payment`,
      JSON.stringify({ stage: "overpaid" }));
    expectRequest(fetchMock.mock.calls[1]!, "POST", refunds.overpayment.path, JSON.stringify(refunds.overpayment.body));
    expectRequest(fetchMock.mock.calls[2]!, "POST", "/v1/sandbox/refunds/wdr_1/simulate", JSON.stringify({ status: "completed" }));
    expectRequest(fetchMock.mock.calls[3]!, "GET", "/v1/refunds/wdr_1");
    expectRequest(fetchMock.mock.calls[4]!, "POST", refunds.create.path, JSON.stringify(refunds.create.body));
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

  it.each([301, 302, 303, 307, 308])("surfaces %s without a redirected request", async (status) => {
    const probe = redirectProbe(status);
    vi.stubGlobal("fetch", probe.fetch);
    const client = new RedirectProbeHttpClient({
      apiKey: "pk_test", apiSecret: "sk_test", baseUrl: "https://refund.invalid",
      fetch: probe.fetch, retry: false, clock: () => 1_700_000_000_000,
    });
    await expect(client.request("POST", "/v1/refunds", {
      invoiceId: "inv_fake", mode: "full", externalOrderId: "original-key",
    })).rejects.toThrow();
    expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0]).toEqual({
      method: "POST", path: "/v1/refunds",
      body: '{"invoice_id":"inv_fake","mode":"full","external_order_id":"original-key"}',
    });
  });

it.each([307, 308])("does not replay the refund POST body after %s", async (status) => {
  const probe = redirectProbe(status);
  vi.stubGlobal("fetch", probe.fetch);
  const client = new RedirectProbeHttpClient({
    apiKey: "pk_test", apiSecret: "sk_test", baseUrl: "https://refund.invalid",
    fetch: probe.fetch, retry: false, clock: () => 1_700_000_000_000,
  });
  await client.request("POST", "/v1/refunds", {
    invoiceId: "inv_fake", mode: "full", externalOrderId: "original-key",
  }).catch(() => undefined);
  expect(probe.calls).toEqual([{
    method: "POST", path: "/v1/refunds",
    body: '{"invoice_id":"inv_fake","mode":"full","external_order_id":"original-key"}',
  }]);
});

it("does not report a redirected custom Fetch response as a successful refund", async () => {
  const response = new Response('{"withdrawal_id":"wdr_fake"}', { status: 200 });
  Object.defineProperty(response, "redirected", { value: true });
  const customFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", customFetch);
  const client = new RedirectProbeHttpClient({
    apiKey: "pk_test", apiSecret: "sk_test", fetch: customFetch, retry: false,
  });
  await expect(client.request("POST", "/v1/refunds", {
    invoiceId: "inv_fake", mode: "full", externalOrderId: "original-key",
  })).rejects.toThrow("outcome is unknown");
  expect(customFetch).toHaveBeenCalledTimes(1);
});

it("IR-52 uses the first standard fetch when a getter would later return a custom transport", async () => {
  const standard = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  const custom = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  vi.stubGlobal("fetch", standard);
  let reads = 0;
  const client = new Paymos({
    apiKey: "pk_test", apiSecret: "sk_test",
    get fetch() { reads += 1; return reads === 1 ? standard : custom; },
  });

  await client.refunds.create("inv_test", "full", "original-key");
  expect(reads).toBe(1);
  expect(standard).toHaveBeenCalledTimes(1);
  expect(custom).not.toHaveBeenCalled();
});

it("IR-52 uses the default when a fetch getter first returns undefined", async () => {
  const standard = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  const custom = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  vi.stubGlobal("fetch", standard);
  let reads = 0;
  const options = {
    apiKey: "pk_test", apiSecret: "sk_test",
    get fetch() { reads += 1; return reads === 1 ? undefined : custom; },
  } as unknown as ConstructorParameters<typeof Paymos>[0];

  await new Paymos(options).refunds.create("inv_test", "full", "original-key");
  expect(reads).toBe(1);
  expect(standard).toHaveBeenCalledTimes(1);
  expect(custom).not.toHaveBeenCalled();
});

it("IR-52 uses the verified fetch if a clock callback replaces it before dispatch", async () => {
  const standard = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  const custom = vi.fn<typeof fetch>().mockResolvedValue(json(REFUND));
  vi.stubGlobal("fetch", standard);
  let client!: Paymos;
  client = new Paymos({
    apiKey: "pk_test", apiSecret: "sk_test",
    clock: () => { ir52ReplaceFetch(client, custom); return 1_700_000_000_000; },
  });

  await client.refunds.create("inv_test", "full", "original-key");
  expect(standard).toHaveBeenCalledTimes(1);
  expect(custom).not.toHaveBeenCalled();
  const init = standard.mock.calls[0]?.[1];
  expect(JSON.parse(String(init?.body))).toMatchObject({ external_order_id: "original-key" });
});
});
