import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealPayPalClient } from '../../src/adapters/paypal/real-paypal-client.js';

describe('RealPayPalClient against Mocked HTTP Layer', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('obtains and caches OAuth token, avoiding duplicate token requests', async () => {
    let fetchCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      fetchCount++;
      if (url.includes('/v1/oauth2/token')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ access_token: 'fake_jwt_token_123', expires_in: 3600 })
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }) as any;

    const client = new RealPayPalClient('client_id_test', 'client_secret_test');

    const token1 = await client.getAccessToken();
    const token2 = await client.getAccessToken();

    expect(token1).toBe('fake_jwt_token_123');
    expect(token2).toBe('fake_jwt_token_123');
    // Only one token network request should have been made due to caching!
    expect(fetchCount).toBe(1);
  });

  it('creates payout with correct headers and payload shape', async () => {
    let capturedUrl = '';
    let capturedOptions: any = null;

    global.fetch = vi.fn().mockImplementation((url: string, options: any) => {
      if (url.includes('/v1/oauth2/token')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ access_token: 'valid_bearer_token', expires_in: 3600 })
        });
      }
      if (url.includes('/v1/payments/payouts')) {
        capturedUrl = url;
        capturedOptions = options;
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              batch_header: {
                payout_batch_id: 'PAYPAL_BATCH_999',
                batch_status: 'PENDING',
                time_created: '2026-11-07T12:00:00Z',
                sender_batch_header: { sender_batch_id: 'proposal_123' }
              }
            })
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not found') });
    }) as any;

    const client = new RealPayPalClient('cid', 'csec');
    const result = await client.createPayout({
      senderBatchId: 'proposal_123',
      emailSubject: 'Vendor Payment for Cloud Services',
      items: [
        {
          receiver: 'vendor@reliablecloud.com',
          amount: 450.0,
          currency: 'USD',
          note: 'Invoice 4092',
          senderItemId: 'item_1'
        }
      ]
    });

    expect(result.batchId).toBe('PAYPAL_BATCH_999');
    expect(result.batchStatus).toBe('PENDING');
    expect(capturedUrl).toContain('/v1/payments/payouts');
    expect(capturedOptions.headers.Authorization).toBe('Bearer valid_bearer_token');

    const body = JSON.parse(capturedOptions.body);
    expect(body.sender_batch_header.sender_batch_id).toBe('proposal_123');
    expect(body.items[0].receiver).toBe('vendor@reliablecloud.com');
    expect(body.items[0].amount.value).toBe('450.00');
  });

  it('handles HTTP error responses from PayPal API gracefully with descriptive messages', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/v1/oauth2/token')) {
        return Promise.resolve({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Invalid client credentials')
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }) as any;

    const client = new RealPayPalClient('bad_id', 'bad_secret');
    await expect(client.getAccessToken()).rejects.toThrow(/PayPal OAuth failed \(401\)/);
  });
});
