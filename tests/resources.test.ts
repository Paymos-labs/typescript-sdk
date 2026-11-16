import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { Paymos, type CreateInvoiceParams, type InvoiceProduct, type Order } from "../src/index.js";

const contract = JSON.parse(
  readFileSync(new URL("../conformance/contract.json", import.meta.url), "utf8"),
) as {
  vectors: {
    invoices: {
      create_single_product: {
        body: Record<string, unknown>;
        response: Record<string, unknown>;
      };
      create_multi_product: {
        body: Record<string, unknown>;
        response: Record<string, unknown>;
      };
      legacy_without_products: {
        body: Record<string, unknown>;
        response: Record<string, unknown>;
      };
      null_products: {
        body: Record<string, unknown>;
        response: Record<string, unknown>;
      };
    };
  };
};

describe("resource routes", () => {
  it("maps every Merchant API operation to the expected method, path, and body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) =>
      new Response(String(input).endsWith("/v1/time") ? '{"server_time":1700000000}' : "{}", { status: 200 }));
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      retry: false,
    });

    await client.invoices.create({
      projectId: "prj_1",
      amount: "10.00",
      currency: "USD",
      externalOrderId: "order_1",
    });
    await client.invoices.get("inv/1");
    await client.invoices.list({ limit: 1 });
    await client.invoices.cancel("inv_1", "customer request");
    await client.invoices.confirmPayment("inv_1", { currency: "USDT", network: "tron" });
    await client.invoices.simulatePayment("inv_1", "paid");
    await client.withdrawals.create({
      destinationAddress: "address",
      network: "tron",
      currency: "USDT",
      amount: "5.00",
      externalOrderId: "payout_1",
    });
    await client.withdrawals.get("wdr_1");
    await client.withdrawals.list({ limit: 1 });
    await client.withdrawals.cancel("wdr_1", "merchant request");
    await client.withdrawals.simulateCompletion("wdr_1");
    await client.balances.get();
    const serverTime = await client.system.time();
    expect(serverTime.serverTime).toBe(1700000000);

    expect(fetchMock.mock.calls.map(([url, init]) => [init?.method, url, init?.body ?? null])).toEqual([
      ["POST", "https://api.paymos.io/v1/invoices", JSON.stringify({ project_id: "prj_1", amount: "10.00", currency: "USD", external_order_id: "order_1" })],
      ["GET", "https://api.paymos.io/v1/invoices/inv%2F1", null],
      ["GET", "https://api.paymos.io/v1/invoices?limit=1", null],
      ["POST", "https://api.paymos.io/v1/invoices/inv_1/cancel", JSON.stringify({ reason: "customer request" })],
      ["POST", "https://api.paymos.io/v1/invoices/inv_1/confirm-payment", JSON.stringify({ currency: "USDT", network: "tron" })],
      ["POST", "https://api.paymos.io/v1/sandbox/invoices/inv_1/simulate-payment", JSON.stringify({ stage: "paid" })],
      ["POST", "https://api.paymos.io/v1/withdrawals", JSON.stringify({ destination_address: "address", network: "tron", currency: "USDT", amount: "5.00", external_order_id: "payout_1" })],
      ["GET", "https://api.paymos.io/v1/withdrawals/wdr_1", null],
      ["GET", "https://api.paymos.io/v1/withdrawals?limit=1", null],
      ["POST", "https://api.paymos.io/v1/withdrawals/wdr_1/cancel", JSON.stringify({ reason: "merchant request" })],
      ["POST", "https://api.paymos.io/v1/sandbox/withdrawals/wdr_1/simulate-completion", null],
      ["GET", "https://api.paymos.io/v1/balances", null],
      ["GET", "https://api.paymos.io/v1/time", null],
    ]);
  });

  it("rejects invalid local guards before sending a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new Paymos({ apiKey: "pk_test_key", apiSecret: "sk_test_secret", fetch: fetchMock });

    expect(() => client.invoices.cancel("inv_1", " ")).toThrow("1 to 500");
    await expect(client.invoices.iterate({}, 0).next()).rejects.toThrow("positive integer");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serializes optional invoice products in snake_case without null optional keys and decodes Order.products", async () => {
    const vectors = contract.vectors.invoices;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(vectors.create_single_product.response), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(vectors.create_multi_product.response), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(vectors.create_multi_product.response), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(vectors.legacy_without_products.response), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(vectors.null_products.response), { status: 201 }));
    const client = new Paymos({
      apiKey: "pk_test_key",
      apiSecret: "sk_test_secret",
      fetch: fetchMock,
      retry: false,
    });

    const singleProduct: InvoiceProduct = {
      title: "Studio Pro",
      description: "One-month access",
      imageUrl: "https://shop.example/images/studio-pro.webp",
      quantity: 2,
      unitAmount: "24.50",
    };
    const singleInvoice = await client.invoices.create({
      projectId: "prj_1",
      amount: "47.00",
      currency: "USD",
      externalOrderId: "order-product-single",
      products: [singleProduct],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(vectors.create_single_product.body);
    expect(singleInvoice.order.products).toEqual([singleProduct]);

    const multiProducts: InvoiceProduct[] = [
      singleProduct,
      {
        title: "Priority Support",
        quantity: 1,
        unitAmount: "12.00",
      },
    ];
    const multiInvoice = await client.invoices.create({
      projectId: "prj_1",
      amount: "59.00",
      currency: "USD",
      externalOrderId: "order-product-multi",
      products: multiProducts,
    });
    const multiBodyText = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(JSON.parse(multiBodyText)).toEqual(vectors.create_multi_product.body);
    expect(multiBodyText).not.toContain("unitAmount");
    expect(multiBodyText).not.toContain("imageUrl");
    expect(multiInvoice.order.products).toEqual([
      singleProduct,
      { title: "Priority Support", quantity: 1, unitAmount: "12.00" },
    ]);

    const nullableMinimal: InvoiceProduct = {
      title: "Priority Support",
      description: null,
      imageUrl: null,
      quantity: 1,
      unitAmount: "12.00",
    };
    await client.invoices.create({
      projectId: "prj_1",
      amount: "59.00",
      currency: "USD",
      externalOrderId: "order-product-multi",
      products: [singleProduct, nullableMinimal],
    });
    const strippedWire = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as {
      products: Array<Record<string, unknown>>;
    };
    expect(strippedWire).toEqual(vectors.create_multi_product.body);
    expect(Object.keys(strippedWire.products[1]!).sort()).toEqual(["quantity", "title", "unit_amount"]);
    // Caller objects remain unmutated.
    expect(nullableMinimal.description).toBeNull();
    expect(nullableMinimal.imageUrl).toBeNull();

    const legacyInvoice = await client.invoices.create({
      projectId: "prj_1",
      amount: "30.00",
      currency: "USD",
      externalOrderId: "order-legacy-1",
    });
    const legacyWire = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)) as Record<string, unknown>;
    expect(legacyWire).toEqual(vectors.legacy_without_products.body);
    expect(Object.hasOwn(legacyWire, "products")).toBe(false);
    expect(legacyInvoice.order.products).toBeUndefined();

    const nullProductsInvoice = await client.invoices.create({
      projectId: "prj_1",
      amount: "30.00",
      currency: "USD",
      externalOrderId: "order-null-products-1",
      products: null,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual(vectors.null_products.body);
    expect(nullProductsInvoice.order.products).toBeUndefined();

    expectTypeOf<CreateInvoiceParams["products"]>().toEqualTypeOf<InvoiceProduct[] | null | undefined>();
    expectTypeOf<Order["products"]>().toEqualTypeOf<InvoiceProduct[] | undefined>();
  });
});
