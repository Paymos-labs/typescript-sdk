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

export type PaymentChannelStatus = "active" | "blocked" | "provisioning";

export type PaymentChannelNetworkStatus = "provisioning" | "active";

export type PaymentChannelDepositStatus = "confirming" | "reorged" | "confirmed";

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

/**
 * The three payment-channel deposit events. Every one of them carries a full
 * {@link PaymentChannelDeposit} as its `data`.
 *
 * ORDERING — `confirming` and `reorged` are ADVISORY and may arrive out of order: a
 * `confirming` can land after the `confirmed` for the same deposit, and a `reorged` can
 * be superseded by a later `confirmed`. Credit the merchant only on
 * `payment_channel.deposit.confirmed` with `isFinal` true, and never let an advisory
 * event regress a deposit already known to be confirmed. Crediting on `confirming`
 * releases goods against money a reorg can still take back.
 */
export type PaymentChannelDepositEventType =
  | "payment_channel.deposit.confirming"
  | "payment_channel.deposit.reorged"
  | "payment_channel.deposit.confirmed";

export type WebhookEventType =
  | InvoiceEventType
  | WithdrawalEventType
  | PaymentChannelDepositEventType
  | (string & {});

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

export interface PaymentChannelToken {
  symbol: string;
  /** Absent = cannot quote a minimum right now. NOT "no minimum". */
  minimumDeposit?: string;
}

export interface PaymentChannelNetwork {
  /** Rail code, e.g. "TRC20" — not a chain nickname. */
  network: NetworkCode;
  status: PaymentChannelNetworkStatus;
  /** Absent until this rail provisions; never changes afterwards. */
  address?: string;
  tokens: PaymentChannelToken[];
}

export interface PaymentChannel {
  id: string;
  projectId: string;
  externalId: string;
  status: PaymentChannelStatus;
  isAcceptingPayments: boolean;
  isFullyProvisioned: boolean;
  isTest: boolean;
  appliedFeePercent: number;
  customerFeePercent: number;
  networks: PaymentChannelNetwork[];
  createdAt: number;
  updatedAt: number;
}

/**
 * A payment-channel deposit. This is both the API resource and the `data` payload of
 * every {@link PaymentChannelDepositEventType} webhook, so a handler decodes one with
 * `verifier.constructEvent<PaymentChannelDeposit>(header, rawBody)`.
 */
export interface PaymentChannelDeposit {
  id: string;
  paymentChannelId: string;
  projectId: string;
  paymentChannelExternalId: string;
  status: PaymentChannelDepositStatus;
  isFinal: boolean;
  isTest: boolean;
  currency: string;
  network: NetworkCode;
  chainId: number;
  contractAddress?: string;
  gross: string;
  fee: string;
  net: string;
  appliedFeePercent: number;
  customerFeePercent: number;
  txHash: string;
  transferId: string;
  sourceAddress?: string;
  destinationAddress: string;
  blockHeight: number;
  firstIncludedBlockTimestamp?: number;
  explorerUrl?: string;
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
}

/** Stable reason codes; the list is open so a new code never breaks a build. */
export type PaymentChannelDepositFeedBlockageReason =
  | "booked_auth_missing"
  | "inconsistent"
  | "deposit_missing"
  | "channel_missing"
  | "transfer_missing"
  | "not_confirmed"
  | (string & {});

/**
 * Why the feed could not render one position. Absent on every normal page, so it explains
 * a stall and never causes one: without it a stuck feed is byte-identical to a quiet day.
 */
export interface PaymentChannelDepositFeedBlockage {
  depositId: string;
  reason: PaymentChannelDepositFeedBlockageReason;
}

/**
 * One page of the confirmed-deposit feed. `nextCursor` is NOT optional: the feed never ends,
 * and an empty page still advances past the global positions this merchant's filter skipped.
 * Never `break` on it — store it and resume from it on the next poll.
 */
export interface PaymentChannelDepositFeedPage {
  items: PaymentChannelDeposit[];
  nextCursor: string;
  blocked?: PaymentChannelDepositFeedBlockage;
}

export interface CreatePaymentChannelParams {
  projectId: string;
  externalId: string;
}

/** The three stages the sandbox can simulate. */
export type SimulateDepositStage = "confirming" | "reorged" | "confirmed";

export interface SimulateDepositParams {
  amount: string;
  currency: string;
  /** Required — the rail the simulated deposit lands on, e.g. "TRC20". */
  network: NetworkCode;
  /** Omitted defaults to confirmed. */
  stage?: SimulateDepositStage;
}

export interface ListPaymentChannelsParams {
  limit?: number;
  cursor?: string;
  status?: PaymentChannelStatus[];
  externalId?: string;
  projectId?: string;
}

/**
 * `confirmedFrom` is an initial-sync lower bound, not the resume mechanism: it answers
 * "start me from this point in time" on the very first poll. Afterwards resume from `cursor`.
 */
export interface ReadPaymentChannelDepositsParams {
  limit?: number;
  cursor?: string;
  projectId?: string;
  paymentChannelId?: string;
  confirmedFrom?: number;
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
  field?: string | null;
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
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
