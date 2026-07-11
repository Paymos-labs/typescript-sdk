# Paymos TypeScript SDK

Official server-side TypeScript and JavaScript SDK for the [Paymos Merchant API](https://paymos.io/docs/quick-start).

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
  project_id: "prj_xxxxxxxxxxxx",
  amount: "49.95",
  currency: "USD",
  external_order_id: externalOrderId("order"),
});

console.log(invoice.payment_url);
```

Use decimal strings for money. Never convert API amounts to JavaScript `number`.

## List and iterate

```ts
const page = await paymos.invoices.list({
  project_id: "prj_xxxxxxxxxxxx",
  status: ["paid", "paid_over"],
  limit: 50,
});

for await (const invoice of paymos.invoices.iterate({ status: ["paid"] }, 10)) {
  console.log(invoice.invoice_id);
}
```

The API uses opaque forward-only cursors. The second `iterate` argument is a client-side maximum page count.

## Withdrawals and balances

```ts
const withdrawal = await paymos.withdrawals.create({
  destination_address: "TRX...whitelisted...address",
  network: "tron",
  currency: "USDT",
  amount: "50.00",
  external_order_id: externalOrderId("payout"),
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

switch (event.event_type) {
  case "invoice.paid":
    // Fulfil idempotently by event.event_id.
    break;
}
```

The verifier accepts multiple `v1` signatures during secret rotation, uses constant-time comparison, and rejects timestamps outside the default five-minute tolerance.

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

- [API documentation](https://paymos.io/docs/quick-start)
- [Invoices](https://paymos.io/docs/invoices/create)
- [Withdrawals](https://paymos.io/docs/withdrawals/create)
- [Webhooks](https://paymos.io/docs/webhooks)
- [Issues](https://github.com/Paymos-labs/typescript-sdk/issues)

## License

MIT
