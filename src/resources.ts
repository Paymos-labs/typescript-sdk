import type { HttpClient } from "./http.js";
import { buildQuery, encodePathSegment } from "./signing.js";
import { toWire } from "./wire.js";
import type {
  Balance,
  ConfirmPaymentParams,
  CreateInvoiceParams,
  CreatePaymentChannelParams,
  CreateWithdrawalParams,
  CursorPage,
  Invoice,
  InvoiceListItem,
  ListInvoicesParams,
  ListPaymentChannelsParams,
  ListWithdrawalsParams,
  PaymentChannel,
  PaymentChannelDeposit,
  PaymentChannelDepositFeedPage,
  ReadPaymentChannelDepositsParams,
  SimulateDepositParams,
  Withdrawal,
  WithdrawalListItem,
} from "./types.js";

export class InvoicesResource {
  constructor(private readonly http: HttpClient) {}

  create(params: CreateInvoiceParams): Promise<Invoice> {
    return this.http.request("POST", "/v1/invoices", params);
  }

  get(invoiceId: string): Promise<Invoice> {
    return this.http.request("GET", `/v1/invoices/${encodePathSegment(invoiceId)}`);
  }

  list(params: ListInvoicesParams = {}): Promise<CursorPage<InvoiceListItem>> {
    return this.http.request("GET", "/v1/invoices", undefined, buildQuery(toWire(params) as Record<string, unknown>));
  }

  async *iterate(params: ListInvoicesParams = {}, maxPages = 100): AsyncGenerator<InvoiceListItem> {
    assertMaxPages(maxPages);
    let cursor = params.cursor;
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const page = await this.list(cursor === undefined ? params : { ...params, cursor });
      yield* page.items;
      const next = page.nextCursor || undefined;
      if (next === undefined) return;
      if (next === cursor) throw new Error("Paymos API returned the same pagination cursor twice.");
      cursor = next;
    }
  }

  cancel(invoiceId: string, reason: string): Promise<Invoice> {
    assertReason(reason);
    return this.http.request("POST", `/v1/invoices/${encodePathSegment(invoiceId)}/cancel`, { reason });
  }

  confirmPayment(invoiceId: string, params: ConfirmPaymentParams): Promise<Invoice> {
    return this.http.request("POST", `/v1/invoices/${encodePathSegment(invoiceId)}/confirm-payment`, params);
  }

  simulatePayment(invoiceId: string, stage: "paid" | "overpaid" | "underpay" | "cancel"): Promise<Invoice> {
    return this.http.request("POST", `/v1/sandbox/invoices/${encodePathSegment(invoiceId)}/simulate-payment`, {
      stage,
    });
  }
}

export class WithdrawalsResource {
  constructor(private readonly http: HttpClient) {}

  create(params: CreateWithdrawalParams): Promise<Withdrawal> {
    return this.http.request("POST", "/v1/withdrawals", params);
  }

  get(withdrawalId: string): Promise<Withdrawal> {
    return this.http.request("GET", `/v1/withdrawals/${encodePathSegment(withdrawalId)}`);
  }

  list(params: ListWithdrawalsParams = {}): Promise<CursorPage<WithdrawalListItem>> {
    return this.http.request("GET", "/v1/withdrawals", undefined, buildQuery(toWire(params) as Record<string, unknown>));
  }

  async *iterate(params: ListWithdrawalsParams = {}, maxPages = 100): AsyncGenerator<WithdrawalListItem> {
    assertMaxPages(maxPages);
    let cursor = params.cursor;
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const page = await this.list(cursor === undefined ? params : { ...params, cursor });
      yield* page.items;
      const next = page.nextCursor || undefined;
      if (next === undefined) return;
      if (next === cursor) throw new Error("Paymos API returned the same pagination cursor twice.");
      cursor = next;
    }
  }

  cancel(withdrawalId: string, reason: string): Promise<Withdrawal> {
    assertReason(reason);
    return this.http.request("POST", `/v1/withdrawals/${encodePathSegment(withdrawalId)}/cancel`, { reason });
  }

  simulateCompletion(withdrawalId: string): Promise<Withdrawal> {
    return this.http.request(
      "POST",
      `/v1/sandbox/withdrawals/${encodePathSegment(withdrawalId)}/simulate-completion`,
    );
  }
}

export class PaymentChannelsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create — or fetch. The same project plus external id answers 200 with the channel that
   * already exists instead of 201 with a duplicate; both are a channel, so a caller never
   * inspects the status. Safe to call on every checkout.
   */
  create(params: CreatePaymentChannelParams): Promise<PaymentChannel> {
    return this.http.request("POST", "/v1/payment-channels", params);
  }

  get(paymentChannelId: string): Promise<PaymentChannel> {
    return this.http.request("GET", `/v1/payment-channels/${encodePathSegment(paymentChannelId)}`);
  }

  list(params: ListPaymentChannelsParams = {}): Promise<CursorPage<PaymentChannel>> {
    return this.http.request(
      "GET",
      "/v1/payment-channels",
      undefined,
      buildQuery(toWire(params) as Record<string, unknown>),
    );
  }

  /** An ordinary keyset list: its cursor is null on the last page, so this terminates. */
  async *iterate(params: ListPaymentChannelsParams = {}, maxPages = 100): AsyncGenerator<PaymentChannel> {
    assertMaxPages(maxPages);
    let cursor = params.cursor;
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const page = await this.list(cursor === undefined ? params : { ...params, cursor });
      yield* page.items;
      const next = page.nextCursor || undefined;
      if (next === undefined) return;
      if (next === cursor) throw new Error("Paymos API returned the same pagination cursor twice.");
      cursor = next;
    }
  }

  /** Returns the updated channel — block is not a void call. */
  block(paymentChannelId: string): Promise<PaymentChannel> {
    return this.http.request("POST", `/v1/payment-channels/${encodePathSegment(paymentChannelId)}/block`);
  }

  unblock(paymentChannelId: string): Promise<PaymentChannel> {
    return this.http.request("POST", `/v1/payment-channels/${encodePathSegment(paymentChannelId)}/unblock`);
  }

  /** Sandbox only — a production credential gets an error, not a deposit. */
  simulateDeposit(paymentChannelId: string, params: SimulateDepositParams): Promise<PaymentChannelDeposit> {
    return this.http.request(
      "POST",
      `/v1/sandbox/payment-channels/${encodePathSegment(paymentChannelId)}/simulate-deposit`,
      params,
    );
  }
}

export class PaymentChannelDepositsResource {
  constructor(private readonly http: HttpClient) {}

  get(depositId: string): Promise<PaymentChannelDeposit> {
    return this.http.request("GET", `/v1/payment-channel-deposits/${encodePathSegment(depositId)}`);
  }

  /**
   * Reads ONE page of the confirmed-deposit feed. Deliberately not called `list` and
   * deliberately without an auto-iterator: the feed has no end, and a helper that looped until
   * the cursor was empty would either loop forever or, worse, stop on the first quiet page and
   * leave the merchant's reconciliation silently behind. Store `nextCursor` and poll again.
   */
  read(params: ReadPaymentChannelDepositsParams = {}): Promise<PaymentChannelDepositFeedPage> {
    return this.http.request(
      "GET",
      "/v1/payment-channel-deposits",
      undefined,
      buildQuery(toWire(params) as Record<string, unknown>),
    );
  }
}

export class BalancesResource {
  constructor(private readonly http: HttpClient) {}

  get(): Promise<Balance[]> {
    return this.http.request("GET", "/v1/balances");
  }
}

export class SystemResource {
  constructor(private readonly http: HttpClient) {}

  time(): Promise<{ serverTime: number }> {
    return this.http.request("GET", "/v1/time");
  }
}

function assertReason(reason: string): void {
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 500) {
    throw new TypeError("Cancellation reason must contain 1 to 500 characters.");
  }
}

function assertMaxPages(maxPages: number): void {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new TypeError("maxPages must be a positive integer.");
  }
}
