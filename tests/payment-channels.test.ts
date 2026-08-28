import { describe, expect, it, vi } from "vitest";
import { Paymos } from "../src/index.js";

/**
 * A channel exactly as the API sends it: snake_case, string money, numeric timestamps, and
 * nulls OMITTED rather than sent — the second rail has not provisioned, so it carries no
 * address, and its token cannot be quoted, so it carries no minimum.
 */
const CHANNEL = {
  id: "pc_1",
  project_id: "prj_1",
  external_id: "customer-42",
  status: "active",
  is_accepting_payments: true,
  is_fully_provisioned: false,
  is_test: true,
  applied_fee_percent: 1.5,
  customer_fee_percent: 0,
  networks: [
    {
      network: "TRC20",
      status: "active",
      address: "TW7pMBrHnhSbrtgpBsFbLXwPfCiKtxaHhq",
      tokens: [{ symbol: "USDT", minimum_deposit: "1.00" }],
    },
    { network: "ERC20", status: "provisioning", tokens: [{ symbol: "USDT" }] },
  ],
  created_at: 1_700_000_000,
  updated_at: 1_700_000_100,
};

const DEPOSIT = {
  id: "pcd_9",
  payment_channel_id: "pc_1",
  project_id: "prj_1",
  payment_channel_external_id: "customer-42",
  status: "confirmed",
  is_final: true,
  is_test: true,
  currency: "USDT",
  network: "TRC20",
  chain_id: 728_126_428,
  contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  gross: "100.00",
  fee: "1.00",
  net: "99.00",
  applied_fee_percent: 1,
  customer_fee_percent: 0,
  tx_hash: "9a2f1c",
  transfer_id: "trf_1",
  source_address: "TPayerAddress",
  destination_address: "TChannelAddress",
  block_height: 60_000_000,
  first_included_block_timestamp: 1_700_000_050,
  explorer_url: "https://tronscan.org/#/transaction/9a2f1c",
  created_at: 1_700_000_000,
  updated_at: 1_700_000_100,
  confirmed_at: 1_700_000_100,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function paymos(fetchMock: typeof globalThis.fetch): Paymos {
  return new Paymos({ apiKey: "pk_test_key", apiSecret: "sk_test_secret", fetch: fetchMock, retry: false });
}

describe("payment channels", () => {
  it("returns the channel from both creates, because the idempotent replay answers 200 and not an error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(CHANNEL, 201))
      .mockResolvedValueOnce(json(CHANNEL, 200));
    const client = paymos(fetchMock);

    const created = await client.paymentChannels.create({ projectId: "prj_1", externalId: "customer-42" });
    const replayed = await client.paymentChannels.create({ projectId: "prj_1", externalId: "customer-42" });

    expect(created.id).toBe("pc_1");
    expect(replayed.id).toBe("pc_1");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.paymos.io/v1/payment-channels");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ project_id: "prj_1", external_id: "customer-42" }),
    );

    // Absent is not null and not zero: this rail has not provisioned, and this token cannot be quoted.
    expect(created.networks[0]?.address).toBe("TW7pMBrHnhSbrtgpBsFbLXwPfCiKtxaHhq");
    expect(created.networks[0]?.tokens[0]?.minimumDeposit).toBe("1.00");
    expect(created.networks[1]?.address).toBeUndefined();
    expect(created.networks[1]?.tokens[0]?.minimumDeposit).toBeUndefined();
    expect(created.appliedFeePercent).toBe(1.5);
    expect(created.createdAt).toBe(1_700_000_000);
  });

  it("hands back the updated channel from block", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ...CHANNEL, status: "blocked", is_accepting_payments: false }));
    const client = paymos(fetchMock);

    const channel = await client.paymentChannels.block("pc_1");

    expect(channel.isAcceptingPayments).toBe(false);
    expect(channel.status).toBe("blocked");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.paymos.io/v1/payment-channels/pc_1/block");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0]?.[1]?.body ?? null).toBeNull();
  });

  it("hands back the updated channel from unblock", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ...CHANNEL, status: "active", is_accepting_payments: true }));
    const client = paymos(fetchMock);

    const channel = await client.paymentChannels.unblock("pc_1");

    expect(channel.isAcceptingPayments).toBe(true);
    expect(channel.status).toBe("active");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.paymos.io/v1/payment-channels/pc_1/unblock");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0]?.[1]?.body ?? null).toBeNull();
  });

  it("still yields a cursor to resume from on an empty feed page", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ items: [], next_cursor: "cur_2" }));
    const client = paymos(fetchMock);

    const page = await client.paymentChannelDeposits.read({ cursor: "cur_1" });

    // The feed is global across merchants: an empty page has still advanced past positions this
    // merchant's filter skipped, so the cursor moves even when nothing matched.
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe("cur_2");
    expect(page.blocked).toBeUndefined();

    // There is no last page, so there is deliberately no auto-iterator to stop on one.
    expect("iterate" in client.paymentChannelDeposits).toBe(false);
  });

  it("surfaces which deposit blocked the feed and why", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json({ items: [], next_cursor: "cur_2", blocked: { deposit_id: "pcd_9", reason: "not_confirmed" } }),
    );
    const client = paymos(fetchMock);

    const page = await client.paymentChannelDeposits.read({ cursor: "cur_1" });

    // Without this a stall is byte-identical to a quiet day.
    expect(page.blocked?.depositId).toBe("pcd_9");
    expect(page.blocked?.reason).toBe("not_confirmed");
    expect(page.nextCursor).toBe("cur_2");
  });

  it("sends every filter in snake_case, because the API rejects unknown query fields", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [CHANNEL], next_cursor: null }))
      .mockResolvedValueOnce(json({ items: [DEPOSIT], next_cursor: "cur_10" }));
    const client = paymos(fetchMock);

    await client.paymentChannels.list({
      limit: 25,
      cursor: "cur_1",
      status: ["blocked", "active"],
      externalId: "customer-42",
      projectId: "prj_1",
    });
    await client.paymentChannelDeposits.read({
      limit: 50,
      cursor: "cur_9",
      projectId: "prj_1",
      paymentChannelId: "pc_1",
      confirmedFrom: 1_700_000_000,
    });

    const channelUrl = String(fetchMock.mock.calls[0]?.[0]);
    const feedUrl = String(fetchMock.mock.calls[1]?.[0]);

    expect(channelUrl).toBe(
      "https://api.paymos.io/v1/payment-channels" +
        "?cursor=cur_1&external_id=customer-42&limit=25&project_id=prj_1&status=active&status=blocked",
    );
    expect(feedUrl).toBe(
      "https://api.paymos.io/v1/payment-channel-deposits" +
        "?confirmed_from=1700000000&cursor=cur_9&limit=50&payment_channel_id=pc_1&project_id=prj_1",
    );
    for (const camelCase of ["externalId", "projectId", "paymentChannelId", "confirmedFrom"]) {
      expect(`${channelUrl}${feedUrl}`).not.toContain(camelCase);
    }
  });

  it("encodes ids as path segments, not as query values", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(CHANNEL))
      .mockResolvedValueOnce(json(DEPOSIT));
    const client = paymos(fetchMock);

    // encodeURIComponent leaves ( ) * alone; the RFC3986 encoder the signature is computed over
    // does not — so a slip here is a signature mismatch, not a cosmetic difference.
    await client.paymentChannels.get("pc_(1)*");
    await client.paymentChannelDeposits.get("pcd/9");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.paymos.io/v1/payment-channels/pc_%281%29%2A");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.paymos.io/v1/payment-channel-deposits/pcd%2F9");
  });

  it("always sends network on simulate and omits stage entirely when unset", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(DEPOSIT))
      .mockResolvedValueOnce(json({ ...DEPOSIT, status: "confirming", is_final: false }));
    const client = paymos(fetchMock);

    await client.paymentChannels.simulateDeposit("pc_1", {
      amount: "100.00",
      currency: "USDT",
      network: "TRC20",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.paymos.io/v1/sandbox/payment-channels/pc_1/simulate-deposit",
    );
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toEqual({ amount: "100.00", currency: "USDT", network: "TRC20" });
    // Not null, not "" — the key must not be on the wire at all.
    expect(body).not.toContain("stage");

    await client.paymentChannels.simulateDeposit("pc_1", {
      amount: "100.00",
      currency: "USDT",
      network: "TRC20",
      stage: "confirming",
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      amount: "100.00",
      currency: "USDT",
      network: "TRC20",
      stage: "confirming",
    });
  });

  it("terminates the channel list iterator on a null cursor", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [CHANNEL], next_cursor: "cur_2" }))
      .mockResolvedValueOnce(json({ items: [{ ...CHANNEL, id: "pc_2" }], next_cursor: null }));
    const client = paymos(fetchMock);

    const ids: string[] = [];
    for await (const channel of client.paymentChannels.iterate()) ids.push(channel.id);

    // The channel list is an ordinary keyset page and DOES end. The feed above does not, which is
    // why only one of the two ships an iterator.
    expect(ids).toEqual(["pc_1", "pc_2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.paymos.io/v1/payment-channels?cursor=cur_2");
  });
});
