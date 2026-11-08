import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { config } from '../../src/server/config.js';
import { PaymentProposal } from '../../src/domain/types.js';

describe('Out-of-Band Vendor Confirmation API', () => {
  const testDb = './data/test_confirmations.db';
  let repo: SqliteRepository;
  let app: any;
  let authCookie: string[];

  const createProposal = (overrides: Partial<PaymentProposal> = {}): PaymentProposal => {
    const proposal: PaymentProposal = {
      id: `prop_${Math.random().toString(36).substring(2, 9)}`,
      vendorId: 'v_cloud',
      vendorName: 'Reliable Cloud Inc',
      amount: 450.0,
      currency: 'USD',
      payee: 'billing@reliablecloud.com',
      requestedPayeeInEmail: 'attacker@evil.com',
      verdict: 'HOLD',
      flags: [
        {
          id: 'payee_change',
          severity: 'HIGH',
          title: 'Payee Change',
          evidence: 'Attacker redirect'
        }
      ],
      status: 'PENDING_REVIEW',
      requiresCallbackCheck: true,
      requiresAmountConfirm: false,
      isHardBlocked: false,
      callbackConfirmed: false,
      callbackNote: null,
      approvalNote: null,
      rejectionReason: null,
      paypalBatchId: null,
      paypalPayoutItemId: null,
      rawEmail: 'Test email',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides
    };
    repo.saveProposal(proposal);
    return proposal;
  };

  beforeEach(async () => {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    repo = new SqliteRepository(testDb);
    app = createApp(repo);

    repo.saveVendor({
      id: 'v_cloud',
      name: 'Reliable Cloud Inc',
      paypalEmails: ['billing@reliablecloud.com'],
      domains: ['reliablecloud.com'],
      phone: '+1-555-0199',
      contactEmail: 'billing-contact@reliablecloud.com',
      typicalAmount: 450.0,
      paymentCount: 8,
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

  it('sends out-of-band confirmation to vendor contactEmail on file', async () => {
    const proposal = createProposal();

    const res = await request(app)
      .post(`/api/proposals/${proposal.id}/send-confirmation`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.confirmation).toBeDefined();
    expect(res.body.sentTo).toBe('billing-contact@reliablecloud.com');
    expect(res.body.confirmationUrl).toContain('/confirm/');

    // Check Outbox
    const outboxRes = await request(app)
      .get('/api/outbox')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1');

    expect(outboxRes.status).toBe(200);
    expect(outboxRes.body.length).toBeGreaterThan(0);
    expect(outboxRes.body[0].to).toBe('billing-contact@reliablecloud.com');
  });

  it('refuses to send confirmation if vendor has no verified contactEmail', async () => {
    repo.saveVendor({
      id: 'v_no_email',
      name: 'Vendor Without Email',
      paypalEmails: ['noemail@vendor.com'],
      domains: ['vendor.com'],
      phone: null,
      contactEmail: null,
      typicalAmount: 200,
      paymentCount: 2,
      source: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const proposal = createProposal({ vendorId: 'v_no_email', vendorName: 'Vendor Without Email' });

    const res = await request(app)
      .post(`/api/proposals/${proposal.id}/send-confirmation`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('does not have a verified contact email on file');
  });

  it('allows public verification via GET and POST /confirm/token/:token', async () => {
    const proposal = createProposal();

    const sendRes = await request(app)
      .post(`/api/proposals/${proposal.id}/send-confirmation`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send();

    const token = sendRes.body.confirmationUrl.split('/confirm/')[1];

    // Public GET details (no auth required)
    const detailsRes = await request(app).get(`/api/confirm/token/${token}`);
    expect(detailsRes.status).toBe(200);
    expect(detailsRes.body.vendorName).toBe('Reliable Cloud Inc');
    expect(detailsRes.body.amount).toBe(450.0);
    expect(detailsRes.body.status).toBe('PENDING');

    // Public POST resolve: CONFIRMED
    const resolveRes = await request(app)
      .post(`/api/confirm/token/${token}`)
      .send({ decision: 'CONFIRMED' });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.status).toBe('CONFIRMED');

    // Policy check: Proposal can now be approved without the phone callback checkbox!
    const approveRes = await request(app)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ approvalNote: 'Approved following vendor out-of-band confirmation' });

    expect(approveRes.status).toBe(200);
    expect(['PAID', 'PAYING']).toContain(approveRes.body.status);
  });

  it('auto-blocks proposal when vendor responds DENIED', async () => {
    const proposal = createProposal();

    const sendRes = await request(app)
      .post(`/api/proposals/${proposal.id}/send-confirmation`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send();

    const token = sendRes.body.confirmationUrl.split('/confirm/')[1];

    // Vendor clicks "No, I did not send this" -> DENIED
    const denyRes = await request(app)
      .post(`/api/confirm/token/${token}`)
      .send({ decision: 'DENIED' });

    expect(denyRes.status).toBe(200);
    expect(denyRes.body.status).toBe('DENIED');

    // Verify proposal is now BLOCKED
    const updatedProposal = repo.getProposalById(proposal.id);
    expect(updatedProposal?.status).toBe('BLOCKED');
    expect(updatedProposal?.rejectionReason).toContain('Vendor explicitly denied');

    // Attempting to approve must fail
    const approveRes = await request(app)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ callbackConfirmed: true, callbackNote: 'Attempt to bypass' });

    expect(approveRes.status).toBe(400);
    expect(approveRes.body.error).toContain('cannot be approved in status \'BLOCKED\'');
  });
});
