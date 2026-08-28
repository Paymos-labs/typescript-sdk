# Paymos TypeScript SDK

Official server-side TypeScript and JavaScript SDK for the [Paymos Merchant API](https://paymos.io/docs/server-sdks) — invoices, withdrawals, balances, and static per-customer wallets with their confirmed-deposit feed.

> Do not use an API secret in browser or mobile code. This package targets trusted Node.js backends and serverless runtimes with Node.js crypto support.

## Install

```bash
npm install @paymos/sdk
```

Node.js 22.12 or newer is required. The package ships ESM, CommonJS, and TypeScript declarations and has no runtime dependencies.

## Quick start

```ts
import { Paymos, externalOrderId } from "@paymos/sdk";

const paymos = new Paymos({
  apiKey: process.env.PAYMOS_API_KEY!,
  apiSecret: process.env.PAYMOS_API_SECRET!,
});

const invoice = await paymos.invoices.create({
  projectId: "prj_xxxxxxxxxxxx",
  amount: "49.95",
  currency: "USD",
  externalOrderId: externalOrderId("order"),
});

console.log(invoice.paymentUrl);
```

Use decimal strings for money. Never convert API amounts to JavaScript `number`.

## List and iterate

```ts
const page = await paymos.invoices.list({
  projectId: "prj_xxxxxxxxxxxx",
  status: ["paid", "paid_over"],
  limit: 50,
});

for await (const invoice of paymos.invoices.iterate({ status: ["paid"] }, 10)) {
  console.log(invoice.invoiceId);
}
```

The API uses opaque forward-only cursors. The second `iterate` argument is a client-side maximum page count.

## Payment channels

A channel is one payer's own reusable set of deposit addresses. Create it, read its rails, then poll the confirmed-deposit feed and persist the cursor you get back:

```ts
const channel = await paymos.paymentChannels.create({
  projectId: "prj_xxxxxxxxxxxx",
  externalId: "customer_42",
});

for (const rail of channel.networks) {
  console.log(rail.network, rail.status, rail.address ?? "not provisioned yet");
  for (const token of rail.tokens) {
    console.log(token.symbol, token.minimumDeposit ?? "minimum unavailable");
  }
}

const feed = await paymos.paymentChannelDeposits.read({ cursor: savedCursor, limit: 100 });
for (const deposit of feed.items) credit(deposit);
await saveCursor(feed.nextCursor);
```

Four things that bite an integrator who guesses:

- Repeating the same `externalId` returns the **same** channel — `200` instead of `201`, and both bodies are a channel. Call it on every checkout; a repeat is not a duplicate and not an error.
- A rail's `address` is **absent until that rail finishes provisioning**, and never changes once it appears. Absent means "not yet", not "no address" — offer the payer only the rails that already have one.
- An absent `minimumDeposit` means "we cannot quote a minimum right now", not "there is no minimum". Treating absent as zero is how a merchant accepts a deposit that lands below the live minimum and is never credited.
- `nextCursor` is **never** empty, not even on a page with no items. Store it and resume from it on the next poll. Do not loop until it is null the way you would with `invoices.iterate`: that loop either spins forever or, worse, stops on the first quiet page and leaves the merchant's reconciliation silently behind. `confirmedFrom` is only the first poll's lower bound — after that the stored cursor is the resume mechanism.

## Withdrawals and balances

```ts
const withdrawal = await paymos.withdrawals.create({
  destinationAddress: "TRX...whitelisted...address",
  network: "TRC20",
  currency: "USDT",
  amount: "50.00",
  externalOrderId: externalOrderId("payout"),
});

const balances = await paymos.balances.get();
```

Use a Payout key (`rk_test_...` or `rk_live_...`) for withdrawals. Destinations must already be whitelisted.

## Webhooks

Always verify the exact raw request body before parsing JSON:

```ts
import { WebhookVerifier } from "@paymos/sdk";

const verifier = new WebhookVerifier(process.env.PAYMOS_WEBHOOK_SECRET!);
const event = verifier.constructEvent(
  request.headers.get("x-webhook-signature") ?? "",
  rawBody,
);

switch (event.eventType) {
  case "invoice.paid":
    // Fulfil idempotently by event.eventId.
    break;
}
```

The verifier accepts multiple `v1` signatures during secret rotation, uses constant-time comparison, and rejects timestamps outside the default five-minute tolerance.

### Payment-channel deposit events

The three `payment_channel.deposit.*` events each carry a full `PaymentChannelDeposit` as
their payload, so pass it as the type argument:

```ts
import type { PaymentChannelDeposit } from "@paymos/sdk";

const event = verifier.constructEvent<PaymentChannelDeposit>(signatureHeader, rawBody);

if (event.eventType === "payment_channel.deposit.confirmed" && event.data.isFinal) {
  credit(event.data.paymentChannelExternalId, event.data.net); // idempotent by event.eventId
}
```

**`confirming` and `reorged` are advisory and may arrive out of order.** A `confirming`
can land after the `confirmed` for the same deposit, and a `reorged` can be superseded by
a later `confirmed`. Credit only on `payment_channel.deposit.confirmed` with `isFinal`
true, and never let an advisory event regress a deposit you already know is confirmed.
Crediting on `confirming` releases goods against money a reorg can still take back.

## Errors and retries

```ts
import { RateLimitError, ValidationError } from "@paymos/sdk";

try {
  await paymos.balances.get();
} catch (error) {
  if (error instanceof ValidationError) console.error(error.code, error.field, error.errors);
  if (error instanceof RateLimitError) console.error(error.retryAfterSeconds);
  throw error;
}
```

The SDK retries `429` responses and retries `5xx` only for idempotent methods. It never blindly retries a side-effecting POST after a server error.

## Links

- [API documentation](https://paymos.io/docs/server-sdks)
- [Invoices](https://paymos.io/docs/invoices/create)
- [Payment channels](https://paymos.io/docs/payment-channels/create)
- [Deposit feed](https://paymos.io/docs/payment-channel-deposits/list)
- [Withdrawals](https://paymos.io/docs/withdrawals/create)
- [Webhooks](https://paymos.io/docs/webhooks)
- [Issues](https://github.com/Paymos-labs/typescript-sdk/issues)

## License

MIT
