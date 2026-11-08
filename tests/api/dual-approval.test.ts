import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { config } from '../../src/server/config.js';
import { PaymentProposal } from '../../src/domain/types.js';

describe('Dual Approval and Cooling-Off API', () => {
  const testDb = './data/test_dual_approval.db';
  let repo: SqliteRepository;
  let app: any;
  let aliceCookie: any;
  let bobCookie: any;

  const createProposal = (overrides: Partial<PaymentProposal> = {}): PaymentProposal => {
    const proposal: PaymentProposal = {
      id: `prop_${Math.random().toString(36).substring(2, 9)}`,
      vendorId: 'v_reliable',
      vendorName: 'Reliable Cloud Inc',
      amount: 1500.0,
      currency: 'USD',
      payee: 'billing@reliablecloud.com',
      requestedPayeeInEmail: null,
      verdict: 'CLEAR',
      flags: [],
      status: 'PENDING_REVIEW',
      requiresCallbackCheck: false,
      requiresAmountConfirm: (overrides.amount ?? 1500.0) > 500,
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
      requiresDualApproval: true,
      firstApprover: null,
      firstApprovedAt: null,
      secondApprover: null,
      secondApprovedAt: null,
      coolingOffUntil: null,
      coolingOffBypassed: false,
      ...overrides
    };
    repo.saveProposal(proposal);
    return proposal;
  };

  beforeEach(async () => {
    if (fs.existsSync(testDb)) {
      try {
        fs.unlinkSync(testDb);
      } catch {}
    }
    repo = new SqliteRepository(testDb);

    // Save vendor and historical payment for reliable payee
    repo.saveVendor({
      id: 'v_reliable',
      name: 'Reliable Cloud Inc',
      paypalEmails: ['billing@reliablecloud.com'],
      domains: ['reliablecloud.com'],
      phone: '+1-555-0100',
      contactEmail: 'security@reliablecloud.com',
      typicalAmount: 500.0,
      paymentCount: 1,
      source: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    repo.savePaymentRecord({
      id: 'pay_hist_1',
      vendorId: 'v_reliable',
      payeeEmail: 'billing@reliablecloud.com',
      amount: 500.0,
      currency: 'USD',
      status: 'SUCCESS',
      paypalBatchId: 'hist_batch_1',
      paidAt: new Date().toISOString()
    });

    // Ensure alice and bob exist in approversMap
    config.approversMap.set('alice', 'pass_alice');
    config.approversMap.set('bob', 'pass_bob');

    app = createApp(repo);

    // Login Alice
    const resAlice = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'pass_alice' });
    aliceCookie = resAlice.headers['set-cookie'];

    // Login Bob
    const resBob = await request(app)
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'pass_bob' });
    bobCookie = resBob.headers['set-cookie'];
  });

  afterEach(() => {
    repo.close();
    if (fs.existsSync(testDb)) {
      try {
        fs.unlinkSync(testDb);
      } catch {}
    }
  });

  it('enforces two different approvers on high amount (>= $1000)', async () => {
    const proposal = createProposal({ amount: 1500.0 });

    // Alice gives first approval
    const res1 = await request(app)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', aliceCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        typedAmountConfirmation: 1500.0,
        approvalNote: 'Looks good to me'
      });

    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('PENDING_REVIEW'); // Remains PENDING_REVIEW!
    expect(res1.body.firstApprover).toBe('alice');
    expect(res1.body.secondApprover).toBeNull();

    // Alice attempts second approval -> rejected!
    const res2 = await request(app)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', aliceCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        typedAmountConfirmation: 1500.0,
        approvalNote: 'Approving again'
      });

    expect(res2.status).toBe(400);
    expect(res2.body.error).toContain('two different approvers');

    // Bob provides second approval -> succeeds and executes payout
    const res3 = await request(app)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', bobCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        typedAmountConfirmation: 1500.0,
        approvalNote: 'Second approver confirmation'
      });

    expect(res3.status).toBe(200);
    expect(['PAID', 'PAYING']).toContain(res3.body.status);
    expect(res3.body.firstApprover).toBe('alice');
    expect(res3.body.secondApprover).toBe('bob');
    expect(res3.body.paypalBatchId).toBeDefined();

    // Audit logs contain both approval entries
    const auditLogs = repo.getAuditLogs();
    const firstApprovalLog = auditLogs.find(l => l.action === 'PROPOSAL_FIRST_APPROVAL');
    const secondApprovalLog = auditLogs.find(l => l.action === 'PROPOSAL_APPROVED');
    expect(firstApprovalLog).toBeDefined();
    expect(firstApprovalLog?.actor).toBe('alice');
    expect(secondApprovalLog).toBeDefined();
    expect(secondApprovalLog?.actor).toBe('bob');
  });

  it('triggers cooling-off period on new payee with no prior payment history', async () => {
    // New payee without payment records
    const proposal = createProposal({
      amount: 250.0, // Below 1000, but new payee
      payee: 'new-supplier@brandnewvendor.com'
    });

    // Alice gives first approval
    const res1 = await request(app)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', aliceCookie)
      .set('X-PayGuard-Request', '1')
      .send({ approvalNote: 'First review' });

    expect(res1.status).toBe(200);
    expect(res1.body.firstApprover).toBe('alice');
    expect(res1.body.coolingOffUntil).toBeDefined();
    expect(new Date(res1.body.coolingOffUntil).getTime()).toBeGreaterThan(Date.now());

    // Bob tries to approve immediately while cooling-off is active
    const res2 = await request(app)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', bobCookie)
      .set('X-PayGuard-Request', '1')
      .send({ approvalNote: 'Second review' });

    expect(res2.status).toBe(400);
    expect(res2.body.error).toContain('cooling-off period');
  });

  it('allows fast-forward bypass only when DEMO_FAST_FORWARD is enabled', async () => {
    const proposal = createProposal({
      amount: 300.0,
      payee: 'brand-new-payee@vendor.com',
      firstApprover: 'alice',
      firstApprovedAt: new Date().toISOString(),
      coolingOffUntil: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      coolingOffBypassed: false
    });

    // When DEMO_FAST_FORWARD is false
    config.DEMO_FAST_FORWARD = false;
    const resBypassBlocked = await request(app)
      .post(`/api/proposals/${proposal.id}/bypass-cooling-off`)
      .set('Cookie', aliceCookie)
      .set('X-PayGuard-Request', '1')
      .send({});

    expect(resBypassBlocked.status).toBe(403);
    expect(resBypassBlocked.body.error).toContain('Demo fast-forward is disabled');

    // When DEMO_FAST_FORWARD is enabled
    config.DEMO_FAST_FORWARD = true;
    const resBypassSuccess = await request(app)
      .post(`/api/proposals/${proposal.id}/bypass-cooling-off`)
      .set('Cookie', bobCookie)
      .set('X-PayGuard-Request', '1')
      .send({});

    expect(resBypassSuccess.status).toBe(200);
    expect(resBypassSuccess.body.coolingOffBypassed).toBe(true);

    // Now Bob can provide the second approval
    const resApprove = await request(app)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', bobCookie)
      .set('X-PayGuard-Request', '1')
      .send({ approvalNote: 'Approved after fast-forward bypass' });

    expect(resApprove.status).toBe(200);
    expect(['PAID', 'PAYING']).toContain(resApprove.body.status);
    expect(resApprove.body.secondApprover).toBe('bob');

    // Reset config
    config.DEMO_FAST_FORWARD = false;
  });
});
