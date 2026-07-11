import { randomUUID } from "node:crypto";
import { HttpClient, type ClientOptions } from "./http.js";
import { BalancesResource, InvoicesResource, WithdrawalsResource } from "./resources.js";

export class Paymos {
  readonly invoices: InvoicesResource;
  readonly withdrawals: WithdrawalsResource;
  readonly balances: BalancesResource;

  constructor(options: ClientOptions) {
    const http = new HttpClient(options);
    this.invoices = new InvoicesResource(http);
    this.withdrawals = new WithdrawalsResource(http);
    this.balances = new BalancesResource(http);
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
