import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { PayPalApiError } from '../../src/adapters/paypal/real-paypal-client.js';
import { IPayPalClient, CreatePayoutBatchRequest, PayoutBatchResponse, SyncedTransaction } from '../../src/application/ports/paypal-client.js';
import { PaymentProposal } from '../../src/domain/types.js';
import { config } from '../../src/server/config.js';

class FailingPayPalClient implements IPayPalClient {
  readonly mode = 'sandbox' as const;

  async createPayout(_batchRequest: CreatePayoutBatchRequest): Promise<PayoutBatchResponse> {
    throw new PayPalApiError(403, {
      name: 'PAYOUT_NOT_AVAILABLE',
      message: 'You live in a country that is not allowed to send this payout.',
      debug_id: 'f708777822fca',
      information_link: 'https://developer.paypal.com/docs/api/payments.payouts-batch/#errors'
    });
  }

  async getPayoutBatchStatus(_batchId: string): Promise<PayoutBatchResponse> {
    throw new Error('Not implemented');
  }

  async syncTransactionHistory(_startDate: string, _endDate: string): Promise<SyncedTransaction[]> {
    return [];
  }

  async verifyWebhookSignature(_headers: Record<string, string>, _rawBody: string): Promise<boolean> {
    return true;
  }
}

describe('PayPal Payout Error Handling & Simulated Fallback Flow', () => {
  const testDb = './data/test_paypal_error.db';
  let repo: SqliteRepository;
  let failingClient: FailingPayPalClient;
  let app: any;
  let authCookie: string[];

  const createProposal = (overrides: Partial<PaymentProposal> = {}): PaymentProposal => {
    const proposal: PaymentProposal = {
      id: `prop_${Math.random().toString(36).substring(2, 9)}`,
      vendorId: 'v_reliable',
      vendorName: 'Reliable Cloud Inc',
      amount: 450.0,
      currency: 'USD',
      payee: 'billing@reliablecloud.com',
      requestedPayeeInEmail: null,
      verdict: 'CLEAR',
      flags: [],
      status: 'PENDING_REVIEW',
      requiresCallbackCheck: false,
      requiresAmountConfirm: false,
      isHardBlocked: false,
      callbackConfirmed: false,
      callbackNote: null,
      approvalNote: null,
      rejectionReason: null,
      paypalBatchId: null,
      paypalPayoutItemId: null,
      rawEmail: 'Test invoice email',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requiresDualApproval: false,
      firstApprover: null,
      firstApprovedAt: null,
      secondApprover: null,
      secondApprovedAt: null,
      coolingOffUntil: null,
      coolingOffBypassed: false,
      source: 'manual',
      ...overrides
    };
    repo.saveProposal(proposal);
    return proposal;
  };

  beforeEach(async () => {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    repo = new SqliteRepository(testDb);
    failingClient = new FailingPayPalClient();
    app = createApp(repo, failingClient);

    repo.saveVendor({
      id: 'v_reliable',
      name: 'Reliable Cloud Inc',
      paypalEmails: ['billing@reliablecloud.com'],
      domains: ['reliablecloud.com'],
      phone: '+1-555-0199',
      typicalAmount: 450.0,
      paymentCount: 5,
      source: 'paypal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ password: config.APP_PASSWORD });

    authCookie = loginRes.headers['set-cookie'] as unknown as string[];
  });

  afterEach(() => {
    repo.close();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  });

  it('handles 403 PAYOUT_NOT_AVAILABLE properly, preserves approval, marks FAILED, and logs audit', async () => {
    // 1. Create a proposal in PENDING_REVIEW
    const proposal = createProposal({
      id: 'prop-err-01'
    });

    // 2. Approver attempts to approve and execute payout
    const res = await request(app)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        approvalNote: 'Approved monthly server bill'
      });

    // Verify HTTP 403 response with rich error context
    expect(res.status).toBe(403);
    expect(res.body.name).toBe('PAYOUT_NOT_AVAILABLE');
    expect(res.body.debug_id).toBe('f708777822fca');
    expect(res.body.countryRestricted).toBe(true);
    expect(res.body.error).toContain('PAYOUT_NOT_AVAILABLE');

    // 3. Verify proposal record state in SQLite
    const updated = repo.getProposalById(proposal.id);
    expect(updated).toBeDefined();
    // Status must be FAILED, NEVER PAID
    expect(updated!.status).toBe('FAILED');
    expect(updated!.paypalBatchId).toBeNull();

    // Human approval MUST be preserved
    expect(updated!.firstApprover).toBe('approver');
    expect(updated!.firstApprovedAt).toBeDefined();
    expect(updated!.approvalNote).toBe('Approved monthly server bill');
    expect(updated!.rejectionReason).toContain('PAYOUT_NOT_AVAILABLE');
    expect(updated!.rejectionReason).toContain('f708777822fca');

    // 4. Verify append-only audit trail
    const auditLogs = repo.getAuditLogs();
    const failedLog = auditLogs.find(l => l.action === 'PAYMENT_FAILED');
    expect(failedLog).toBeDefined();
    expect(failedLog!.details.httpStatus).toBe(403);
    expect(failedLog!.details.errorName).toBe('PAYOUT_NOT_AVAILABLE');
    expect(failedLog!.details.debugId).toBe('f708777822fca');
    expect(failedLog!.details.transactionReference).toBe(proposal.id);
    expect(failedLog!.details.timestamp).toBeDefined();

    // 5. Verify that duplicate approve attempts are blocked
    const duplicateApprove = await request(app)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ approvalNote: 'Trying to approve again' });

    expect(duplicateApprove.status).toBe(400);
    expect(duplicateApprove.body.error).toContain('must be PENDING_REVIEW');

    // 6. Demonstrate user-initiated Mock Mode Fallback (Simulated Payout)
    const simRes = await request(app)
      .post(`/api/proposals/${proposal.id}/simulate-payout`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({});

    expect(simRes.status).toBe(200);
    expect(simRes.body.status).toBe('PAID');
    expect(simRes.body.paypalBatchId).toMatch(/^SIMULATED-MOCK-/);

    // Verify DB reflects PAID and SIMULATED batch ID
    const afterSim = repo.getProposalById(proposal.id);
    expect(afterSim!.status).toBe('PAID');
    expect(afterSim!.paypalBatchId).toMatch(/^SIMULATED-MOCK-/);

    // Verify PAYMENT_SIMULATED audit log
    const updatedLogs = repo.getAuditLogs();
    const simLog = updatedLogs.find(l => l.action === 'PAYMENT_SIMULATED');
    expect(simLog).toBeDefined();
    expect(simLog!.details.simulated).toBe(true);
    expect(simLog!.details.paypalBatchId).toMatch(/^SIMULATED-MOCK-/);
    expect(simLog!.details.amount).toBe(450.0);

    // Attempting to simulate a second time is rejected
    const repeatSimRes = await request(app)
      .post(`/api/proposals/${proposal.id}/simulate-payout`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({});

    expect(repeatSimRes.status).toBe(400);
    expect(repeatSimRes.body.error).toContain('already been paid');
  });

  it('rejects simulation if proposal has not been approved by a human', async () => {
    const unapproved = createProposal({
      id: 'prop-unapproved',
      amount: 100.0
    });

    const res = await request(app)
      .post(`/api/proposals/${unapproved.id}/simulate-payout`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('has not been approved');
  });
});
