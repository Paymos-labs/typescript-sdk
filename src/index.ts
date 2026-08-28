import { randomUUID } from "node:crypto";
import { HttpClient, type ClientOptions } from "./http.js";
import {
  BalancesResource,
  InvoicesResource,
  PaymentChannelDepositsResource,
  PaymentChannelsResource,
  SystemResource,
  WithdrawalsResource,
} from "./resources.js";

export class Paymos {
  readonly invoices: InvoicesResource;
  readonly withdrawals: WithdrawalsResource;
  readonly paymentChannels: PaymentChannelsResource;
  readonly paymentChannelDeposits: PaymentChannelDepositsResource;
  readonly balances: BalancesResource;
  readonly system: SystemResource;

  constructor(options: ClientOptions) {
    const http = new HttpClient(options);
    this.invoices = new InvoicesResource(http);
    this.withdrawals = new WithdrawalsResource(http);
    this.paymentChannels = new PaymentChannelsResource(http);
    this.paymentChannelDeposits = new PaymentChannelDepositsResource(http);
    this.balances = new BalancesResource(http);
    this.system = new SystemResource(http);
  }
}

export function externalOrderId(prefix = "order"): string {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(prefix)) {
    throw new TypeError("externalOrderId prefix must contain 1 to 32 letters, digits, underscores, or hyphens.");
  }
  return `${prefix}_${randomUUID()}`;
}

export type { ClientOptions, RetryOptions } from "./http.js";
export * from "./errors.js";
export * from "./signing.js";
export * from "./types.js";
export * from "./webhooks.js";
export { SDK_VERSION } from "./version.js";
