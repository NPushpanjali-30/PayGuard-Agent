export interface PayoutItemRequest {
  receiver: string;
  amount: number;
  currency: string;
  note?: string;
  senderItemId: string;
}

export interface CreatePayoutBatchRequest {
  senderBatchId: string;
  emailSubject: string;
  items: PayoutItemRequest[];
}

export interface PayoutBatchResponse {
  batchId: string;
  batchStatus: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'DENIED' | 'CANCELED';
  senderBatchId: string;
  timeCreated?: string;
  payoutItemId?: string;
  rawResponse?: Record<string, unknown>;
}

export interface SyncedTransaction {
  transactionId: string;
  payeeEmail: string;
  amount: number;
  currency: string;
  status: string;
  transactionTime: string;
}

export interface IPayPalClient {
  readonly mode: 'mock' | 'sandbox';
  createPayout(batchRequest: CreatePayoutBatchRequest): Promise<PayoutBatchResponse>;
  getPayoutBatchStatus(batchId: string): Promise<PayoutBatchResponse>;
  syncTransactionHistory(startDate: string, endDate: string): Promise<SyncedTransaction[]>;
  verifyWebhookSignature(headers: Record<string, string>, rawBody: string): Promise<boolean>;
}
