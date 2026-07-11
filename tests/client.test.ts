import { describe, expect, it, vi } from "vitest";
import { Paymos, RateLimitError } from "../src/index.js";

describe("Paymos client", () => {
  it("signs the exact list query and returns a cursor page", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [], next_cursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      clock: () => 1_700_000_000_000,
      retry: false,
    });

    await expect(client.invoices.list({ status: ["paid_over", "paid"], limit: 50 })).resolves.toEqual({
      items: [],
      next_cursor: null,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.paymos.io/v1/invoices?limit=50&status=paid&status=paid_over");
    expect(new Headers(init?.headers).get("authorization")).toMatch(/^HMAC-SHA256 pk_test_key:/);
  });

  it("maps RFC 9457 rate limit responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ title: "Too Many Requests", status: 429, code: "rate_limited" }), {
        status: 429,
        headers: { "retry-after": "7" },
      }),
    );
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      retry: false,
    });

    const error = await client.balances.get().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).code).toBe("rate_limited");
    expect((error as RateLimitError).retryAfterSeconds).toBe(7);
  });

  it("iterates cursor pages without accepting a repeated cursor", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ invoice_id: "inv_1" }], next_cursor: "next" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ invoice_id: "inv_2" }], next_cursor: null })));
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      retry: false,
    });

    const ids: string[] = [];
    for await (const invoice of client.invoices.iterate({}, 2)) ids.push(invoice.invoice_id);
    expect(ids).toEqual(["inv_1", "inv_2"]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.paymos.io/v1/invoices?cursor=next");
  });
});
