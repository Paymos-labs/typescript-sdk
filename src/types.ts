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

export interface CreateInvoiceParams {
  project_id: string;
  amount: string;
  currency: string;
  external_order_id: string;
  network?: string | null;
  allow_multiple_payments?: boolean;
  customer_fee_percent?: number | null;
  client_id?: string | null;
}

export interface ConfirmPaymentParams {
  currency: string;
  network: string;
}

export interface Order {
  external_id: string;
  client_id: string | null;
  amount: string;
  currency: string;
  network: string | null;
}

export interface Transfer {
  tx_hash: string;
  amount: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  required_confirmations: number | null;
  estimated_confirmation_at: string | null;
  explorer_url: string | null;
}

export interface Payment {
  currency: string;
  network: string;
  chain_id: number;
  contract_address: string | null;
  expected: string;
  address: string | null;
  exchange_rate: string | null;
  paid: string | null;
  remaining: string | null;
  fee: string | null;
  net: string | null;
  transfers: Transfer[] | null;
}

export interface Invoice {
  invoice_id: string;
  project_id: string;
  status: InvoiceStatus;
  is_final: boolean;
  is_test: boolean;
  payment_url: string;
  order: Order;
  payment: Payment | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  completed_at: string | null;
}

export interface InvoiceListItem {
  invoice_id: string;
  project_id: string;
  external_order_id: string;
  client_id: string | null;
  status: InvoiceStatus;
  is_final: boolean;
  is_test: boolean;
  amount: string;
  currency: string;
  network: string | null;
  created_at: string;
  expires_at: string | null;
  completed_at: string | null;
}

export interface ListInvoicesParams {
  limit?: number;
  cursor?: string;
  status?: InvoiceStatus[];
  external_order_id?: string;
  project_id?: string;
  created_from?: number;
  created_to?: number;
}

export interface CreateWithdrawalParams {
  destination_address: string;
  network: string;
  currency: string;
  amount: string;
  external_order_id: string;
}

export interface Withdrawal {
  withdrawal_id: string;
  external_order_id: string;
  status: WithdrawalStatus;
  is_final: boolean;
  is_test: boolean;
  amount: string;
  fee: string | null;
  currency: string;
  network: string;
  destination_address: string;
  tx_hash: string | null;
  explorer_url: string | null;
  created_at: string;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
}

export type WithdrawalListItem = Omit<Withdrawal, "tx_hash" | "explorer_url">;

export interface ListWithdrawalsParams {
  limit?: number;
  cursor?: string;
  status?: WithdrawalStatus[];
  external_order_id?: string;
  created_from?: number;
  created_to?: number;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
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
  trace_id?: string;
}

export interface WebhookEvent<T = unknown> {
  event_id: string;
  event_type: string;
  created_at: string;
  data: T;
}
