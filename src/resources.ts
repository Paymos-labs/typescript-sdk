import type { HttpClient } from "./http.js";
import { buildQuery, encodePathSegment } from "./signing.js";
import { toWire } from "./wire.js";
import type {
  Balance,
  ConfirmPaymentParams,
  CreateInvoiceParams,
  CreateWithdrawalParams,
  CursorPage,
  Invoice,
  InvoiceListItem,
  ListInvoicesParams,
  ListWithdrawalsParams,
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
