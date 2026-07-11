import { describe, expect, it, vi } from "vitest";
import { Paymos } from "../src/index.js";

describe("resource routes", () => {
  it("maps every Merchant API operation to the expected method, path, and body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 200 }));
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      retry: false,
    });

    await client.invoices.create({
      project_id: "prj_1",
      amount: "10.00",
      currency: "USD",
      external_order_id: "order_1",
    });
    await client.invoices.get("inv/1");
    await client.invoices.cancel("inv_1", "customer request");
    await client.invoices.confirmPayment("inv_1", { currency: "USDT", network: "tron" });
    await client.invoices.simulatePayment("inv_1", "paid");
    await client.withdrawals.create({
      destination_address: "address",
      network: "tron",
      currency: "USDT",
      amount: "5.00",
      external_order_id: "payout_1",
    });
    await client.withdrawals.get("wdr_1");
    await client.withdrawals.cancel("wdr_1", "merchant request");
    await client.withdrawals.simulateCompletion("wdr_1");
    await client.balances.get();

    expect(fetchMock.mock.calls.map(([url, init]) => [init?.method, url, init?.body ?? null])).toEqual([
      ["POST", "https://api.paymos.io/v1/invoices", JSON.stringify({ project_id: "prj_1", amount: "10.00", currency: "USD", external_order_id: "order_1" })],
      ["GET", "https://api.paymos.io/v1/invoices/inv%2F1", null],
      ["POST", "https://api.paymos.io/v1/invoices/inv_1/cancel", JSON.stringify({ reason: "customer request" })],
      ["POST", "https://api.paymos.io/v1/invoices/inv_1/confirm-payment", JSON.stringify({ currency: "USDT", network: "tron" })],
      ["POST", "https://api.paymos.io/v1/sandbox/invoices/inv_1/simulate-payment", JSON.stringify({ stage: "paid" })],
      ["POST", "https://api.paymos.io/v1/withdrawals", JSON.stringify({ destination_address: "address", network: "tron", currency: "USDT", amount: "5.00", external_order_id: "payout_1" })],
      ["GET", "https://api.paymos.io/v1/withdrawals/wdr_1", null],
      ["POST", "https://api.paymos.io/v1/withdrawals/wdr_1/cancel", JSON.stringify({ reason: "merchant request" })],
      ["POST", "https://api.paymos.io/v1/sandbox/withdrawals/wdr_1/simulate-completion", null],
      ["GET", "https://api.paymos.io/v1/balances", null],
    ]);
  });

  it("rejects invalid local guards before sending a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new Paymos({ apiKey: "pk_test_key", apiSecret: "sk_test_secret", fetch: fetchMock });

    expect(() => client.invoices.cancel("inv_1", " ")).toThrow("1 to 500");
    await expect(client.invoices.iterate({}, 0).next()).rejects.toThrow("positive integer");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
