import { describe, expect, it, vi } from "vitest";
import { Paymos, ServerError } from "../src/index.js";

describe("bounded retries", () => {
  it("retries a GET after 5xx and refreshes its timestamp", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    let now = 1_700_000_000_000;
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      clock: () => (now += 1000),
      retry: { maxRetries: 1, baseDelayMs: 0 },
    });

    await expect(client.balances.get()).resolves.toEqual([]);
    const first = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-request-timestamp");
    const second = new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("x-request-timestamp");
    expect([first, second]).toEqual(["1700000001", "1700000002"]);
  });

  it("does not retry a side-effecting POST after 5xx", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("server error", { status: 500 }));
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      retry: { maxRetries: 2, baseDelayMs: 0 },
    });

    await expect(client.invoices.cancel("inv_1", "customer request")).rejects.toBeInstanceOf(ServerError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a rate-limited POST because rate limiting precedes processing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      retry: { maxRetries: 1, baseDelayMs: 0 },
    });

    await expect(client.invoices.cancel("inv_1", "customer request")).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
