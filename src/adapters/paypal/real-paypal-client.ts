import {
  IPayPalClient,
  CreatePayoutBatchRequest,
  PayoutBatchResponse,
  SyncedTransaction
} from '../../application/ports/paypal-client.js';

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export class PayPalApiError extends Error {
  public readonly status: number;
  public readonly errorName: string;
  public readonly debugId?: string;
  public readonly details?: any;
  public readonly isCountryRestricted: boolean;

  constructor(status: number, data: any) {
    const errorName = data?.name || 'PAYPAL_API_ERROR';
    const message = data?.message || `PayPal API request failed with status ${status}`;
    super(`PayPal Payout creation failed (${status}): [${errorName}] ${message}`);
    this.name = 'PayPalApiError';
    this.status = status;
    this.errorName = errorName;
    this.debugId = data?.debug_id;
    this.details = data;
    this.isCountryRestricted =
      errorName === 'PAYOUT_NOT_AVAILABLE' ||
      (status === 403 && typeof message === 'string' && message.toLowerCase().includes('country'));
  }
}

export class RealPayPalClient implements IPayPalClient {
  public readonly mode = 'sandbox';
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private webhookId?: string;
  private cachedToken: CachedToken | null = null;

  constructor(
    clientId: string,
    clientSecret: string,
    webhookId?: string,
    baseUrl: string = 'https://api-m.sandbox.paypal.com'
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.webhookId = webhookId;
    this.baseUrl = baseUrl;
  }

  /**
   * Retrieves or reuses a cached OAuth2 bearer token from PayPal Sandbox.
   */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtMs - 60000) {
      return this.cachedToken.accessToken;
    }

    const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`PayPal OAuth failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.cachedToken = {
      accessToken: data.access_token,
      expiresAtMs: Date.now() + data.expires_in * 1000
    };

    return data.access_token;
  }

  /**
   * Executes a payout via PayPal Payouts API (POST /v1/payments/payouts).
   */
  async createPayout(batchRequest: CreatePayoutBatchRequest): Promise<PayoutBatchResponse> {
    const token = await this.getAccessToken();

    const payload = {
      sender_batch_header: {
        sender_batch_id: batchRequest.senderBatchId,
        email_subject: batchRequest.emailSubject
      },
      items: batchRequest.items.map(item => ({
        recipient_type: 'EMAIL',
        amount: {
          value: item.amount.toFixed(2),
          currency: item.currency
        },
        receiver: item.receiver,
        note: item.note || 'Vendor payment via PayGuard Agent',
        sender_item_id: item.senderItemId
      }))
    };

    const response = await fetch(`${this.baseUrl}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = (await response.json()) as any;

    if (!response.ok) {
      // Check for duplicate batch ID (idempotency in PayPal)
      if (data.name === 'DUPLICATE_REQUEST_ID' || data.name === 'BATCH_ALREADY_EXISTS') {
        // Retrieve existing batch status
        const batchHeader = data.details?.[0] || data;
        return {
          batchId: batchHeader.payout_batch_id || batchRequest.senderBatchId,
          batchStatus: 'PENDING',
          senderBatchId: batchRequest.senderBatchId,
          rawResponse: data
        };
      }
      throw new PayPalApiError(response.status, data);
    }

    const header = data.batch_header || {};
    return {
      batchId: header.payout_batch_id,
      batchStatus: this.mapPayPalStatus(header.batch_status),
      senderBatchId: header.sender_batch_header?.sender_batch_id || batchRequest.senderBatchId,
      timeCreated: header.time_created,
      rawResponse: data
    };
  }

  /**
   * Polls batch status from PayPal Payouts API (GET /v1/payments/payouts/{batch_id}).
   */
  async getPayoutBatchStatus(batchId: string): Promise<PayoutBatchResponse> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseUrl}/v1/payments/payouts/${batchId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`PayPal Payout status fetch failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as any;
    const header = data.batch_header || {};
    const item = data.items?.[0] || {};

    return {
      batchId: header.payout_batch_id || batchId,
      batchStatus: this.mapPayPalStatus(header.batch_status),
      senderBatchId: header.sender_batch_header?.sender_batch_id || '',
      timeCreated: header.time_created,
      payoutItemId: item.payout_item_id,
      rawResponse: data
    };
  }

  /**
   * Syncs transaction history via GET /v1/reporting/transactions.
   * Chunks date ranges into 31-day intervals as required by PayPal Reporting API.
   * Gracefully returns empty list if Reporting API is unavailable or disabled in sandbox.
   */
  async syncTransactionHistory(startDate: string, endDate: string): Promise<SyncedTransaction[]> {
    const token = await this.getAccessToken();
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    const thirtyOneDaysMs = 31 * 24 * 60 * 60 * 1000;

    const intervals: Array<{ start: string; end: string }> = [];
    let currentStart = startMs;

    while (currentStart < endMs) {
      const currentEnd = Math.min(currentStart + thirtyOneDaysMs, endMs);
      intervals.push({
        start: new Date(currentStart).toISOString(),
        end: new Date(currentEnd).toISOString()
      });
      currentStart = currentEnd;
    }

    const transactions: SyncedTransaction[] = [];

    for (const interval of intervals) {
      try {
        const url = `${this.baseUrl}/v1/reporting/transactions?start_date=${encodeURIComponent(
          interval.start
        )}&end_date=${encodeURIComponent(interval.end)}&fields=all&page_size=100`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          // If transaction reporting is not enabled on this sandbox client, log warning and continue
          console.warn(
            `PayPal transaction reporting returned status ${response.status} for interval ${interval.start} - ${interval.end}`
          );
          continue;
        }

        const data = (await response.json()) as any;
        const details = data.transaction_details || [];

        for (const item of details) {
          const info = item.transaction_info || {};
          const payerInfo = item.payer_info || {};

          if (info.transaction_id && (info.payer_email || payerInfo.email_address)) {
            transactions.push({
              transactionId: info.transaction_id,
              payeeEmail: (info.payer_email || payerInfo.email_address || '').toLowerCase(),
              amount: Math.abs(parseFloat(info.transaction_amount?.value || '0')),
              currency: info.transaction_amount?.currency_code || 'USD',
              status: info.transaction_status === 'S' ? 'SUCCESS' : info.transaction_status || 'UNKNOWN',
              transactionTime: info.transaction_initiation_date || new Date().toISOString()
            });
          }
        }
      } catch (err) {
        console.warn(`Error querying interval ${interval.start}:`, err);
      }
    }

    return transactions;
  }

  /**
   * Verifies webhook authenticity using PayPal's verify-webhook-signature API.
   */
  async verifyWebhookSignature(headers: Record<string, string>, rawBody: string): Promise<boolean> {
    if (!this.webhookId) {
      return false;
    }

    const token = await this.getAccessToken();

    const verificationPayload = {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: this.webhookId,
      webhook_event: JSON.parse(rawBody)
    };

    const response = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(verificationPayload)
    });

    if (!response.ok) return false;
    const data = (await response.json()) as { verification_status: string };
    return data.verification_status === 'SUCCESS';
  }

  private mapPayPalStatus(status?: string): 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'DENIED' | 'CANCELED' {
    switch (status) {
      case 'SUCCESS':
        return 'SUCCESS';
      case 'DENIED':
        return 'DENIED';
      case 'CANCELED':
        return 'CANCELED';
      case 'PROCESSING':
        return 'PROCESSING';
      case 'PENDING':
      default:
        return 'PENDING';
    }
  }
}
