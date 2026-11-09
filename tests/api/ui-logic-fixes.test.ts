import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { MockPayPalClient } from '../../src/adapters/paypal/mock-paypal-client.js';
import { SAMPLE_EMAILS } from '../../src/adapters/ai/sample-data.js';
import { config } from '../../src/server/config.js';

describe('UI and Logic Issues Fixes (Issues 1, 2, 3)', () => {
  const testDb = './data/test_ui_logic_fixes.db';
  let repo: SqliteRepository;
  let mockPayPalClient: MockPayPalClient;
  let app: any;
  let authCookie: string[];

  beforeEach(async () => {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    repo = new SqliteRepository(testDb);
    // Use MockPayPalClient with short transition delay (50ms) for testing polling
    mockPayPalClient = new MockPayPalClient(50);
    app = createApp(repo, mockPayPalClient);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ password: config.APP_PASSWORD });

    authCookie = loginRes.headers['set-cookie'] as unknown as string[];
  });

  afterEach(() => {
    repo.close();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  });

  describe('Issue 1: Vendor matching and payee defaulting', () => {
    it('does NOT default payee to email address if no vendor record matches the sender', async () => {
      // Email from unregistered vendor: invoice from billing@unregistered-consulting.com
      const rawEmail = `From: "Jane Consultant" <billing@unregistered-consulting.com>
To: accounting@mybusiness.com
Subject: Consulting Invoice #501
Date: Mon, 09 Nov 2026 10:00:00 -0400

Please find invoice #501 attached for $350.00 USD for marketing consulting services.
Please remit payment to billing@unregistered-consulting.com.`;

      const checkRes = await request(app)
        .post('/api/email/check')
        .set('Cookie', authCookie)
        .set('X-PayGuard-Request', '1')
        .send({ rawEmail });

      expect(checkRes.status).toBe(200);
      expect(checkRes.body.proposal).not.toBeNull();
      // MUST NOT default payee to the email's address!
      expect(checkRes.body.proposal.payee).toBeNull();
      expect(checkRes.body.proposal.vendorId).toBeNull();

      const proposalId = checkRes.body.proposal.id;

      // Attempting to approve must fail and be rejected by policy
      const approveRes = await request(app)
        .post(`/api/proposals/${proposalId}/approve`)
        .set('Cookie', authCookie)
        .set('X-PayGuard-Request', '1')
        .send({ approvalNote: 'Trying to approve without payee on file' });

      expect(approveRes.status).toBe(400);
      expect(approveRes.body.error).toContain('No verified payee on file');
      expect(approveRes.body.error).toContain('Vendors page');

      // Now add the vendor on the Vendors page (audit-logged)
      const addVendorRes = await request(app)
        .post('/api/vendors')
        .set('Cookie', authCookie)
        .set('X-PayGuard-Request', '1')
        .send({
          name: 'Unregistered Consulting LLC',
          payeeEmail: 'verified-billing@unregistered-consulting.com',
          domains: ['unregistered-consulting.com'],
          typicalAmount: 350.0
        });

      expect(addVendorRes.status).toBe(201);
      const auditLogs = repo.getAuditLogs();
      const vendorCreatedLog = auditLogs.find(l => l.action === 'VENDOR_CREATED');
      expect(vendorCreatedLog).toBeDefined();
      expect(vendorCreatedLog?.details.name).toBe('Unregistered Consulting LLC');

      // Fetch proposal -> now auto-links to newly added verified vendor record
      const getProposalRes = await request(app)
        .get(`/api/proposals/${proposalId}`)
        .set('Cookie', authCookie)
        .set('X-PayGuard-Request', '1');

      expect(getProposalRes.status).toBe(200);
      expect(getProposalRes.body.payee).toBe('verified-billing@unregistered-consulting.com');
      expect(getProposalRes.body.vendorId).toBe(addVendorRes.body.id);

      // Verify audit log for PROPOSAL_VENDOR_LINKED
      const linkedLog = repo.getAuditLogs().find(l => l.action === 'PROPOSAL_VENDOR_LINKED');
      expect(linkedLog).toBeDefined();

      // Now approve: records first approval (new payee policy requires dual approval)
      const approveAfterVendorRes = await request(app)
        .post(`/api/proposals/${proposalId}/approve`)
        .set('Cookie', authCookie)
        .set('X-PayGuard-Request', '1')
        .send({ approvalNote: 'Approved after vendor was added on Vendors page' });

      expect(approveAfterVendorRes.status).toBe(200);
      expect(approveAfterVendorRes.body.firstApprover).toBeDefined();
      expect(approveAfterVendorRes.body.payee).toBe('verified-billing@unregistered-consulting.com');

      // Second approval by different approver completes the payout flow
      config.approversMap.set('bob', 'pass_bob');
      const bobLogin = await request(app)
        .post('/api/auth/login')
        .send({ password: 'pass_bob', username: 'bob' });
      const bobCookie = bobLogin.headers['set-cookie'] as unknown as string[];

      config.DEMO_FAST_FORWARD = true;
      await request(app)
        .post(`/api/proposals/${proposalId}/bypass-cooling-off`)
        .set('Cookie', bobCookie)
        .set('X-PayGuard-Request', '1');

      const secondApproveRes = await request(app)
        .post(`/api/proposals/${proposalId}/approve`)
        .set('Cookie', bobCookie)
        .set('X-PayGuard-Request', '1')
        .send({ approvalNote: 'Second approval by Bob' });

      expect(secondApproveRes.status).toBe(200);
      expect(['PAID', 'PAYING']).toContain(secondApproveRes.body.status);
      expect(secondApproveRes.body.secondApprover).toBe('bob');
    });
  });

  describe('Issue 2: Email attacker requested vs matches payee on file', () => {
    beforeEach(() => {
      // Seed vendor record
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
    });

    it('identifies attacker requested payee when requested payee differs from payee on file', async () => {
      const fraudSample = SAMPLE_EMAILS.find(s => s.id === 'sample-fraud-new-payee')!;

      const res = await request(app)
        .post('/api/email/check')
        .set('Cookie', authCookie)
        .set('X-PayGuard-Request', '1')
        .send({ rawEmail: fraudSample.rawEmail });

      expect(res.status).toBe(200);
      const proposal = res.body.proposal;
      expect(proposal.payee).toBe('billing@reliablecloud.com');
      // Requested payee differs from payee on file!
      expect(proposal.requestedPayeeInEmail).toContain('alice-payouts-temp@fastmail.com');
      expect(proposal.requestedPayeeInEmail).not.toBe(proposal.payee);
    });

    it('matches payee on file when requested payee in email is identical to payee on file', async () => {
      const honestSample = SAMPLE_EMAILS.find(s => s.id === 'sample-honest-invoice-1')!;

      const res = await request(app)
        .post('/api/email/check')
        .set('Cookie', authCookie)
        .set('X-PayGuard-Request', '1')
        .send({ rawEmail: honestSample.rawEmail });

      expect(res.status).toBe(200);
      const proposal = res.body.proposal;
      expect(proposal.payee).toBe('billing@reliablecloud.com');
      // Requested payee in email matches payee on file!
      expect(proposal.requestedPayeeInEmail).toBe('billing@reliablecloud.com');
      expect(proposal.requestedPayeeInEmail).toBe(proposal.payee);
    });
  });

  describe('Issue 3: Auto-polling PayPal batch status and transition to PAID', () => {
    beforeEach(() => {
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
    });

    it('polls PayPal batch status and updates proposal to PAID with recorded payment record', async () => {
      // Create a proposal in PAYING status
      const proposalId = 'prop_poll_test';
      const batchId = 'MOCK-BATCH-POLL123';

      repo.saveProposal({
        id: proposalId,
        vendorId: 'v_cloud',
        vendorName: 'Reliable Cloud Inc',
        amount: 450.0,
        currency: 'USD',
        payee: 'billing@reliablecloud.com',
        requestedPayeeInEmail: null,
        verdict: 'CLEAR',
        flags: [],
        status: 'PAYING',
        requiresCallbackCheck: false,
        requiresAmountConfirm: false,
        isHardBlocked: false,
        callbackConfirmed: false,
        callbackNote: null,
        approvalNote: 'Approved for testing polling',
        rejectionReason: null,
        paypalBatchId: batchId,
        paypalPayoutItemId: 'MOCK-ITEM-1',
        rawEmail: '...',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Create a batch in MockPayPalClient that will transition to SUCCESS
      await mockPayPalClient.createPayout({
        senderBatchId: proposalId,
        emailSubject: 'Test Payout',
        items: [
          {
            receiver: 'billing@reliablecloud.com',
            amount: 450.0,
            currency: 'USD',
            senderItemId: 'item-1'
          }
        ]
      });

      // Override the batch map so batchId matches proposal's paypalBatchId
      // Wait for mock client's auto-transition delay (50ms)
      await new Promise(resolve => setTimeout(resolve, 70));

      // Get batch status directly from mock PayPal client to verify it transitioned
      const pBatch = await mockPayPalClient.createPayout({
        senderBatchId: proposalId,
        emailSubject: 'Test Payout',
        items: []
      });
      // Update the proposal with the actual batchId created in Mock client
      const proposal = repo.getProposalById(proposalId)!;
      proposal.paypalBatchId = pBatch.batchId;
      repo.saveProposal(proposal);

      // Now call GET /api/proposals/:id/poll
      const pollRes = await request(app)
        .get(`/api/proposals/${proposalId}/poll`)
        .set('Cookie', authCookie)
        .set('X-PayGuard-Request', '1');

      expect(pollRes.status).toBe(200);
      expect(pollRes.body.status).toBe('PAID');

      // Verify proposal is updated in database
      const updated = repo.getProposalById(proposalId);
      expect(updated?.status).toBe('PAID');

      // Verify payment record was created in database
      const payments = repo.getPaymentRecords();
      const payment = payments.find(p => p.paypalBatchId === pBatch.batchId);
      expect(payment).toBeDefined();
      expect(payment?.status).toBe('SUCCESS');
      expect(payment?.amount).toBe(450.0);
    });
  });
});
