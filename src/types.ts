export type InvoiceStatus =
  | "awaiting_client"
  | "awaiting_payment"
  | "confirming"
  | "underpaid_waiting"
  | "paid"
  | "paid_over"
  | "underpaid"
  | "expired"
  | "cancelled";

export type WithdrawalStatus =
  | "created"
  | "pending_review"
  | "signed"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type NetworkCode =
  | "TRC20"
  | "ERC20"
  | "BEP20"
  | "POLYGON"
  | "ARBITRUM"
  | "OPTIMISM"
  | "BASE"
  | "TON"
  | "AVAX"
  | "SOL"
  | "NEAR"
  | "SUI"
  | "PLASMA"
  | (string & {});

export type InvoiceEventType =
  | "invoice.awaiting_payment"
  | "invoice.confirming"
  | "invoice.underpaid_waiting"
  | "invoice.paid"
  | "invoice.paid_over"
  | "invoice.underpaid"
  | "invoice.expired"
  | "invoice.cancelled";

export type WithdrawalEventType =
  | "withdrawal.created"
  | "withdrawal.processing"
  | "withdrawal.completed"
  | "withdrawal.failed"
  | "withdrawal.cancelled";

export type WebhookEventType = InvoiceEventType | WithdrawalEventType | (string & {});

export interface CreateInvoiceParams {
  projectId: string;
  amount: string;
  currency: string;
  externalOrderId: string;
  network?: NetworkCode | null;
  allowMultiplePayments?: boolean;
  customerFeePercent?: number | null;
  clientId?: string | null;
}

export interface ConfirmPaymentParams {
  currency: string;
  network: NetworkCode;
}

export interface Order {
  externalId: string;
  clientId?: string;
  amount: string;
  currency: string;
  network?: NetworkCode;
}

export interface Transfer {
  txHash: string;
  amount: string;
  status: "confirming" | "confirmed";
  createdAt: number;
  confirmedAt?: number;
  requiredConfirmations?: number;
  estimatedConfirmationAt?: number;
  explorerUrl?: string;
}

export interface Payment {
  currency: string;
  network: NetworkCode;
  chainId: number;
  contractAddress?: string;
  expected: string;
  address?: string;
  exchangeRate?: string;
  paid?: string;
  remaining?: string;
  fee?: string;
  net?: string;
  transfers?: Transfer[];
}

export interface Invoice {
  invoiceId: string;
  projectId: string;
  status: InvoiceStatus;
  isFinal: boolean;
  isTest: boolean;
  paymentUrl: string;
  order: Order;
  payment?: Payment;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  completedAt?: number;
}

export interface InvoiceListItem {
  invoiceId: string;
  projectId: string;
  externalOrderId: string;
  clientId?: string;
  status: InvoiceStatus;
  isFinal: boolean;
  isTest: boolean;
  amount: string;
  currency: string;
  network?: NetworkCode;
  createdAt: number;
  expiresAt?: number;
  completedAt?: number;
}

export interface ListInvoicesParams {
  limit?: number;
  cursor?: string;
  status?: InvoiceStatus[];
  externalOrderId?: string;
  projectId?: string;
  createdFrom?: number;
  createdTo?: number;
}

export interface CreateWithdrawalParams {
  destinationAddress: string;
  network: NetworkCode;
  currency: string;
  amount: string;
  externalOrderId: string;
}

export interface Withdrawal {
  withdrawalId: string;
  externalOrderId: string;
  status: WithdrawalStatus;
  isFinal: boolean;
  isTest: boolean;
  amount: string;
  fee?: string;
  currency: string;
  network: NetworkCode;
  destinationAddress: string;
  txHash?: string;
  explorerUrl?: string;
  createdAt: number;
  completedAt?: number;
  failedAt?: number;
  cancelledAt?: number;
}

export type WithdrawalListItem = Omit<Withdrawal, "txHash" | "explorerUrl">;

export interface ListWithdrawalsParams {
  limit?: number;
  cursor?: string;
  status?: WithdrawalStatus[];
  externalOrderId?: string;
  createdFrom?: number;
  createdTo?: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Balance {
  currency: string;
  available: string;
}

export interface ProblemError {
  code: string;
  field: string | null;
  message: string;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  field?: string | null;
  errors?: ProblemError[];
  traceId?: string;
}

export interface WebhookEvent<T = unknown> {
  eventId: string;
  eventType: WebhookEventType;
  version: number;
  occurredAt: number;
  data: T;
}
