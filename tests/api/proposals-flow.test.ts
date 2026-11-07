import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { SAMPLE_EMAILS } from '../../src/adapters/ai/sample-data.js';
import { config } from '../../src/server/config.js';

describe('Payment Proposals Lifecycle & Approval Flow', () => {
  const testDb = './data/test_proposals.db';
  let repo: SqliteRepository;
  let app: any;
  let authCookie: string[];

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

  it('completes approval flow in Mock mode, reaching PAID status', async () => {
    const honestSample = SAMPLE_EMAILS.find(s => s.id === 'sample-honest-invoice-1')!;

    // 1. Check email -> creates proposal
    const checkRes = await request(app)
      .post('/api/email/check')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ rawEmail: honestSample.rawEmail });

    const proposalId = checkRes.body.proposal.id;
    expect(proposalId).toBeDefined();
    expect(checkRes.body.proposal.status).toBe('PENDING_REVIEW');

    // 2. Approve proposal
    const approveRes = await request(app)
      .post(`/api/proposals/${proposalId}/approve`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        approvalNote: 'Approved for November hosting services'
      });

    expect(approveRes.status).toBe(200);
    expect(['PAID', 'PAYING']).toContain(approveRes.body.status);
    expect(approveRes.body.paypalBatchId).toBeDefined();

    // 3. Verify double-approval is strictly rejected
    const doubleApproveRes = await request(app)
      .post(`/api/proposals/${proposalId}/approve`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ approvalNote: 'Trying to approve again' });

    expect(doubleApproveRes.status).toBe(400);
    expect(doubleApproveRes.body.error).toContain('must be PENDING_REVIEW');
  });

  it('strictly enforces callback confirmation for HOLD proposals', async () => {
    const fraudSample = SAMPLE_EMAILS.find(s => s.id === 'sample-fraud-new-payee')!;

    const checkRes = await request(app)
      .post('/api/email/check')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ rawEmail: fraudSample.rawEmail });

    const proposalId = checkRes.body.proposal.id;
    expect(checkRes.body.verdict).toBe('HOLD');

    // Attempt approve without checkbox
    const failedApprove = await request(app)
      .post(`/api/proposals/${proposalId}/approve`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ approvalNote: 'Trying to approve without callback' });

    expect(failedApprove.status).toBe(400);
    expect(failedApprove.body.error).toContain('I called the verified number on file');

    // Approve WITH checkbox and note
    const successApprove = await request(app)
      .post(`/api/proposals/${proposalId}/approve`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        callbackConfirmed: true,
        callbackNote: 'Spoke with CFO Alice on +1-555-0199 who verified invoice #8841.'
      });

    expect(successApprove.status).toBe(200);
    expect(['PAID', 'PAYING']).toContain(successApprove.body.status);
  });

  it('rejects approval when amount exceeds APPROVAL_LIMIT without typed confirmation', async () => {
    // Save proposal with amount $1200 (> APPROVAL_LIMIT 500)
    repo.saveProposal({
      id: 'prop_high_val',
      vendorId: 'v_cloud',
      vendorName: 'Reliable Cloud Inc',
      amount: 1200.0,
      currency: 'USD',
      payee: 'billing@reliablecloud.com',
      requestedPayeeInEmail: null,
      verdict: 'CLEAR',
      flags: [],
      status: 'PENDING_REVIEW',
      requiresCallbackCheck: false,
      requiresAmountConfirm: true,
      isHardBlocked: false,
      callbackConfirmed: false,
      callbackNote: null,
      approvalNote: null,
      rejectionReason: null,
      paypalBatchId: null,
      paypalPayoutItemId: null,
      rawEmail: '...',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Attempt without typed confirmation
    const resNoConfirm = await request(app)
      .post('/api/proposals/prop_high_val/approve')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({});

    expect(resNoConfirm.status).toBe(400);
    expect(resNoConfirm.body.error).toContain('type the exact amount');

    // Attempt with incorrect typed confirmation
    const resWrongConfirm = await request(app)
      .post('/api/proposals/prop_high_val/approve')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ typedAmountConfirmation: 1000 });

    expect(resWrongConfirm.status).toBe(400);

    // Attempt with exact typed confirmation
    const resCorrectConfirm = await request(app)
      .post('/api/proposals/prop_high_val/approve')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ typedAmountConfirmation: 1200 });

    expect(resCorrectConfirm.status).toBe(200);
  });

  it('blocks approval of amounts exceeding HARD_LIMIT', async () => {
    repo.saveProposal({
      id: 'prop_blocked',
      vendorId: 'v_cloud',
      vendorName: 'Reliable Cloud Inc',
      amount: 10000.0,
      currency: 'USD',
      payee: 'billing@reliablecloud.com',
      requestedPayeeInEmail: null,
      verdict: 'HOLD',
      flags: [],
      status: 'BLOCKED',
      requiresCallbackCheck: true,
      requiresAmountConfirm: false,
      isHardBlocked: true,
      callbackConfirmed: false,
      callbackNote: null,
      approvalNote: null,
      rejectionReason: 'Exceeds hard limit',
      paypalBatchId: null,
      paypalPayoutItemId: null,
      rawEmail: '...',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const res = await request(app)
      .post('/api/proposals/prop_blocked/approve')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        callbackConfirmed: true,
        callbackNote: 'Verified with CEO',
        typedAmountConfirmation: 10000
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('cannot be approved in status');
  });
});
