import { describe, it, expect } from 'vitest';
import { MockPayPalClient } from '../../src/adapters/paypal/mock-paypal-client.js';

describe('Mock PayPal Client Tests', () => {
  it('creates payout and simulates auto-transition from PENDING to SUCCESS', async () => {
    // Set delay to 50ms for speedy test execution
    const client = new MockPayPalClient(50);

    const result = await client.createPayout({
      senderBatchId: 'test-batch-001',
      emailSubject: 'Test Invoice Payout',
      items: [
        {
          receiver: 'vendor@reliable.com',
          amount: 250.0,
          currency: 'USD',
          senderItemId: 'item-001'
        }
      ]
    });

    expect(result.batchId).toBeDefined();
    expect(result.batchStatus).toBe('PENDING');

    // Wait 70ms for auto-transition
    await new Promise(r => setTimeout(r, 70));

    const polled = await client.getPayoutBatchStatus(result.batchId);
    expect(polled.batchStatus).toBe('SUCCESS');
  });

  it('simulates payout failure scenario for specific trigger inputs', async () => {
    const client = new MockPayPalClient();

    const failureResult = await client.createPayout({
      senderBatchId: 'test-fail-002',
      emailSubject: 'Failed Payment',
      items: [
        {
          receiver: 'fail@example.com',
          amount: 100.0,
          currency: 'USD',
          senderItemId: 'item-fail'
        }
      ]
    });

    expect(failureResult.batchStatus).toBe('DENIED');
  });

  it('maintains idempotency for duplicate senderBatchId requests', async () => {
    const client = new MockPayPalClient();

    const first = await client.createPayout({
      senderBatchId: 'idempotent-batch-1',
      emailSubject: 'Invoice #1',
      items: [{ receiver: 'payee@test.com', amount: 50, currency: 'USD', senderItemId: 'i1' }]
    });

    const second = await client.createPayout({
      senderBatchId: 'idempotent-batch-1',
      emailSubject: 'Invoice #1 Retry',
      items: [{ receiver: 'payee@test.com', amount: 50, currency: 'USD', senderItemId: 'i1' }]
    });

    expect(second.batchId).toBe(first.batchId);
  });

  it('returns mock transaction history records', async () => {
    const client = new MockPayPalClient();
    const history = await client.syncTransactionHistory('2026-01-01', '2026-11-07');
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].payeeEmail).toBeDefined();
    expect(history[0].amount).toBeGreaterThan(0);
  });
});
