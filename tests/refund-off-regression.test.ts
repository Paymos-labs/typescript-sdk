import { describe, expect, it, vi } from "vitest";
import { ConfigurationError, Paymos } from "../src/index.js";
import type { HttpClient } from "../src/http.js";
import { RefundsResource } from "../src/resources.js";
import { toWire } from "../src/wire.js";

const options = {
  apiKey: "pk_test", apiSecret: "sk_test", baseUrl: "http://127.0.0.1:38473", retry: false as const,
};

describe("refund creation temporarily disabled until the transport is verifiable", () => {
  it.each(["full", "overpayment"] as const)("rejects %s before an unknown Fetch is invoked", async (mode) => {
    const custom = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const client = new Paymos({ ...options, fetch: custom });
    await expect(client.refunds.create("inv_fake", mode, "same-key")).rejects.toBeInstanceOf(ConfigurationError);
    expect(custom).not.toHaveBeenCalled();
  });

  it("rejects explicit same-key replays without dispatch", async () => {
    const custom = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const client = new Paymos({ ...options, fetch: custom });
    for (let i = 0; i < 2; i++) {
      await expect(client.refunds.create("inv_fake", "full", "same-key")).rejects.toBeInstanceOf(ConfigurationError);
    }
    expect(custom).not.toHaveBeenCalled();
  });

  it("rejects before an ambient dispatcher used by native Fetch is called", async () => {
    const symbol = Symbol.for("undici.globalDispatcher.1");
    const previous = Object.getOwnPropertyDescriptor(globalThis, symbol);
    const dispatch = vi.fn(() => { throw new Error("dispatcher must not be called"); });
    const standard = globalThis.fetch;
    Object.defineProperty(globalThis, symbol, previous
      ? { ...previous, value: { dispatch } }
      : { configurable: true, writable: true, value: { dispatch } });
    try {
      const client = new Paymos(options);
      await expect(client.refunds.create("inv_fake", "full", "same-key")).rejects.toBeInstanceOf(ConfigurationError);
      expect(globalThis.fetch).toBe(standard);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      if (previous) Object.defineProperty(globalThis, symbol, previous);
      else Reflect.deleteProperty(globalThis, symbol);
    }
  });

  it("keeps the configured transport for invoice reads, refund history and sandbox simulation", async () => {
    const custom = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"items":[],"next_cursor":null}', { status: 200 }));
    const client = new Paymos({ ...options, fetch: custom });
    await client.invoices.get("inv_fake");
    await client.refunds.get("wdr_fake");
    await client.refunds.list();
    await client.refunds.simulate("wdr_fake", "completed");
    expect(custom.mock.calls.map(([url, init]) => ({ path: new URL(String(url)).pathname, method: init?.method }))).toEqual([
      { path: "/v1/invoices/inv_fake", method: "GET" },
      { path: "/v1/refunds/wdr_fake", method: "GET" },
      { path: "/v1/refunds", method: "GET" },
      { path: "/v1/sandbox/refunds/wdr_fake/simulate", method: "POST" },
    ]);
    expect(custom.mock.calls[3]?.[1]?.body).toBe('{"status":"completed"}');
  });

  it("rejects before reading a substituted transport or serializing a payload", async () => {
    const client = new Paymos(options);
    const internal = (client.refunds as unknown as { http: { options: Record<string, unknown>; request: HttpClient["request"] } }).http;
    const transportReads = vi.fn(() => { throw new Error("transport getter ran"); });
    const payloadReads = vi.fn(() => { throw new Error("payload getter ran"); });
    Object.defineProperty(internal.options, "fetch", { configurable: true, get: transportReads });
    const payload = new Proxy({}, { ownKeys: payloadReads });
    await expect(internal.request("POST", "/v1/refunds", payload)).rejects.toBeInstanceOf(ConfigurationError);
    expect(transportReads).not.toHaveBeenCalled();
    expect(payloadReads).not.toHaveBeenCalled();
  });
});

describe("dormant refund wire contract without a transport", () => {
  it.each(["full", "overpayment"] as const)("constructs the %s body without performing a request", async (mode) => {
    const request = vi.fn().mockResolvedValue({ withdrawalId: "wdr_fixture" });
    const refunds = new RefundsResource({ request } as unknown as HttpClient);
    await refunds.create("inv_fake", mode, "same-key");
    expect(request).toHaveBeenCalledWith("POST", "/v1/refunds", {
      invoiceId: "inv_fake", mode, externalOrderId: "same-key",
    });
    expect(JSON.stringify(toWire(request.mock.calls[0]![2]))).toBe(
      `{"invoice_id":"inv_fake","mode":"${mode}","external_order_id":"same-key"}`,
    );
  });

  it("constructs the same key and mode for an explicit replay without performing a request", async () => {
    const request = vi.fn().mockResolvedValue({ withdrawalId: "wdr_fixture" });
    const refunds = new RefundsResource({ request } as unknown as HttpClient);
    await refunds.create("inv_fake", "full", "same-key");
    await refunds.create("inv_fake", "full", "same-key");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  });
});
