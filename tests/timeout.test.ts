import { describe, expect, it, vi } from "vitest";
import { Paymos, PaymosError } from "../src/index.js";

// The abort signal of an attempt is what cuts a stalled body short, so every fake below wires
// `init.signal` into the response body the same way a real fetch transport does: headers arrive
// immediately, the body only ever ends because the signal aborted it.
function headersThenStalledBody(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockImplementation((_url, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("This operation was aborted.", "AbortError"));
        });
      },
    });
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    );
  });
}

function stalledSend(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted.", "AbortError"));
        });
      }),
  );
}

describe("attempt deadline covers the response body", () => {
  it("cuts off a GET whose body stalls after the headers and does not retry it", async () => {
    const fetchMock = headersThenStalledBody();
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      timeoutMs: 100,
      retry: { maxRetries: 2, baseDelayMs: 0 },
    });

    const startedAt = Date.now();
    await expect(client.system.time()).rejects.toBeInstanceOf(PaymosError);
    const elapsed = Date.now() - startedAt;

    // The body read is an unknown outcome, so retries must not kick in even for a GET.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("cuts off a POST whose body stalls after the headers and sends it exactly once", async () => {
    const fetchMock = headersThenStalledBody();
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      timeoutMs: 100,
      retry: { maxRetries: 2, baseDelayMs: 0 },
    });

    await expect(client.invoices.cancel("inv_1", "customer request")).rejects.toBeInstanceOf(
      PaymosError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("reads a body that completes before the deadline", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode('{"server_time":1700000000}'));
            controller.close();
          }, 40);
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
      );
    });
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      timeoutMs: 2_000,
      retry: false,
    });

    await expect(client.system.time()).resolves.toEqual({ serverTime: 1_700_000_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still retries an idempotent GET whose send stalls past the timeout", async () => {
    const fetchMock = stalledSend();
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      timeoutMs: 50,
      retry: { maxRetries: 1, baseDelayMs: 0 },
    });

    await expect(client.system.time()).rejects.toBeInstanceOf(PaymosError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends a POST whose send stalls exactly once", async () => {
    const fetchMock = stalledSend();
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      timeoutMs: 50,
      retry: { maxRetries: 2, baseDelayMs: 0 },
    });

    await expect(client.invoices.cancel("inv_1", "customer request")).rejects.toBeInstanceOf(
      PaymosError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
