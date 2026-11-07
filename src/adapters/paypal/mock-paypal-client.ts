import crypto from 'node:crypto';
import {
  IPayPalClient,
  CreatePayoutBatchRequest,
  PayoutBatchResponse,
  SyncedTransaction
} from '../../application/ports/paypal-client.js';

interface StoredMockBatch {
  batchId: string;
  senderBatchId: string;
  emailSubject: string;
  batchStatus: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'DENIED' | 'CANCELED';
  createdAtMs: number;
  items: Array<{
    payoutItemId: string;
    receiver: string;
    amount: number;
    currency: string;
    senderItemId: string;
  }>;
}

export class MockPayPalClient implements IPayPalClient {
  public readonly mode = 'mock';
  private batches = new Map<string, StoredMockBatch>();
  private senderBatchMap = new Map<string, string>(); // senderBatchId -> batchId
  public autoTransitionDelayMs: number;

  constructor(autoTransitionDelayMs: number = 3000) {
    this.autoTransitionDelayMs = autoTransitionDelayMs;
  }

  async createPayout(batchRequest: CreatePayoutBatchRequest): Promise<PayoutBatchResponse> {
    // Check duplicate senderBatchId (idempotency check per PayPal API)
    if (this.senderBatchMap.has(batchRequest.senderBatchId)) {
      const existingBatchId = this.senderBatchMap.get(batchRequest.senderBatchId)!;
      const existing = this.batches.get(existingBatchId)!;
      return {
        batchId: existing.batchId,
        batchStatus: existing.batchStatus,
        senderBatchId: existing.senderBatchId,
        payoutItemId: existing.items[0]?.payoutItemId
      };
    }

    const batchId = 'MOCK-BATCH-' + crypto.randomUUID().slice(0, 10).toUpperCase();
    const isFailureCase = batchRequest.items.some(
      item => item.receiver === 'fail@example.com' || item.amount === 999.99
    );

    const initialStatus = isFailureCase ? 'DENIED' : 'PENDING';
    const payoutItemId = 'MOCK-ITEM-' + crypto.randomUUID().slice(0, 8).toUpperCase();

    const storedBatch: StoredMockBatch = {
      batchId,
      senderBatchId: batchRequest.senderBatchId,
      emailSubject: batchRequest.emailSubject,
      batchStatus: initialStatus,
      createdAtMs: Date.now(),
      items: batchRequest.items.map(item => ({
        payoutItemId,
        receiver: item.receiver,
        amount: item.amount,
        currency: item.currency,
        senderItemId: item.senderItemId
      }))
    };

    this.batches.set(batchId, storedBatch);
    this.senderBatchMap.set(batchRequest.senderBatchId, batchId);

    return {
      batchId,
      batchStatus: initialStatus,
      senderBatchId: batchRequest.senderBatchId,
      timeCreated: new Date().toISOString(),
      payoutItemId,
      rawResponse: { mode: 'mock', batchHeader: storedBatch }
    };
  }

  async getPayoutBatchStatus(batchId: string): Promise<PayoutBatchResponse> {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new Error(`Mock PayPal Payout Batch ${batchId} not found.`);
    }

    // Check if status should auto-transition from PENDING to SUCCESS
    if (batch.batchStatus === 'PENDING') {
      const elapsed = Date.now() - batch.createdAtMs;
      if (elapsed >= this.autoTransitionDelayMs) {
        batch.batchStatus = 'SUCCESS';
      }
    }

    return {
      batchId: batch.batchId,
      batchStatus: batch.batchStatus,
      senderBatchId: batch.senderBatchId,
      payoutItemId: batch.items[0]?.payoutItemId,
      rawResponse: { mode: 'mock', status: batch.batchStatus }
    };
  }

  async syncTransactionHistory(startDate: string, endDate: string): Promise<SyncedTransaction[]> {
    return [
      {
        transactionId: 'TX-MOCK-101',
        payeeEmail: 'billing@reliablecloud.com',
        amount: 450.00,
        currency: 'USD',
        status: 'SUCCESS',
        transactionTime: new Date(Date.now() - 86400000 * 5).toISOString()
      },
      {
        transactionId: 'TX-MOCK-102',
        payeeEmail: 'billing@reliablecloud.com',
        amount: 450.00,
        currency: 'USD',
        status: 'SUCCESS',
        transactionTime: new Date(Date.now() - 86400000 * 35).toISOString()
      },
      {
        transactionId: 'TX-MOCK-103',
        payeeEmail: 'payments@fastshipping.net',
        amount: 125.00,
        currency: 'USD',
        status: 'SUCCESS',
        transactionTime: new Date(Date.now() - 86400000 * 12).toISOString()
      }
    ];
  }

  async verifyWebhookSignature(_headers: Record<string, string>, _rawBody: string): Promise<boolean> {
    return true;
  }
}
