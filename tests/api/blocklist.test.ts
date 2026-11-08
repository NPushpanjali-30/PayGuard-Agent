import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { config } from '../../src/server/config.js';
import { PaymentProposal } from '../../src/domain/types.js';

describe('Milestone 7: Blocklist Learning API and Logic', () => {
  const testDb = './data/test_blocklist.db';
  let repo: SqliteRepository;
  let app: any;
  let authCookie: any;

  beforeEach(async () => {
    if (fs.existsSync(testDb)) {
      try {
        fs.unlinkSync(testDb);
      } catch {}
    }
    repo = new SqliteRepository(testDb);

    // Seed test vendor
    repo.saveVendor({
      id: 'v_verified',
      name: 'Verified Services Ltd',
      paypalEmails: ['payments@verifiedservices.com'],
      domains: ['verifiedservices.com'],
      contactEmail: 'billing-contact@verifiedservices.com',
      typicalAmount: 500,
      paymentCount: 5,
      source: 'manual',
      phone: '+1-555-0100',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    config.approversMap.set('approver', 'testpass');
    app = createApp(repo);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'approver', password: 'testpass' });
    authCookie = loginRes.headers['set-cookie'];
  });

  afterEach(() => {
    try {
      repo.close();
    } catch {}
    if (fs.existsSync(testDb)) {
      try {
        fs.unlinkSync(testDb);
      } catch {}
    }
  });

  it('prevents blocking a domain or payee belonging to a verified vendor on file', async () => {
    // 1. Attempt to block verified vendor domain
    const senderRes = await request(app)
      .post('/api/blocklist/senders')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        domain: 'verifiedservices.com',
        reason: 'Attempted block on legitimate vendor'
      });
    expect(senderRes.status).toBe(400);
    expect(senderRes.body.error).toContain('belonging to verified vendor on file');

    // 2. Attempt to block verified vendor paypal email
    const payeeRes = await request(app)
      .post('/api/blocklist/payees')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        identifier: 'payments@verifiedservices.com',
        reason: 'Attempted block on legitimate payee'
      });
    expect(payeeRes.status).toBe(400);
    expect(payeeRes.body.error).toContain('belonging to verified vendor on file');

    // 3. Attempt to block verified vendor contact email
    const contactRes = await request(app)
      .post('/api/blocklist/payees')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        identifier: 'billing-contact@verifiedservices.com',
        reason: 'Attempted block on legitimate contact'
      });
    expect(contactRes.status).toBe(400);
    expect(contactRes.body.error).toContain('belonging to verified vendor on file');
  });

  it('allows adding and removing blocked senders and payees via API, recording audit logs', async () => {
    // 1. Add blocked sender
    const addSender = await request(app)
      .post('/api/blocklist/senders')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        domain: 'evil-phish-domain.org',
        reason: 'Known executive BEC phishing campaign'
      });
    expect(addSender.status).toBe(201);
    expect(addSender.body.domain).toBe('evil-phish-domain.org');
    const senderId = addSender.body.id;

    // 2. Add blocked payee
    const addPayee = await request(app)
      .post('/api/blocklist/payees')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        identifier: 'attacker-money-mule@suspicious.net',
        reason: 'Identified money mule account'
      });
    expect(addPayee.status).toBe(201);
    expect(addPayee.body.identifier).toBe('attacker-money-mule@suspicious.net');
    const payeeId = addPayee.body.id;

    // 3. Verify getBlocklist lists both entries
    const listRes = await request(app)
      .get('/api/blocklist')
      .set('Cookie', authCookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.senders.some((s: any) => s.id === senderId)).toBe(true);
    expect(listRes.body.payees.some((p: any) => p.id === payeeId)).toBe(true);

    // 4. Remove both entries
    const delSender = await request(app)
      .delete(`/api/blocklist/senders/${senderId}`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1');
    expect(delSender.status).toBe(200);

    const delPayee = await request(app)
      .delete(`/api/blocklist/payees/${payeeId}`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1');
    expect(delPayee.status).toBe(200);

    // 5. Verify audit log captured additions and removals
    const auditLogs = repo.getAuditLogs();
    const actions = auditLogs.map(a => a.action);
    expect(actions).toContain('SENDER_BLOCKED');
    expect(actions).toContain('PAYEE_BLOCKED');
    expect(actions).toContain('SENDER_UNBLOCKED');
    expect(actions).toContain('PAYEE_UNBLOCKED');
  });

  it('rejecting a proposal with block flags adds sender and payee to blocklist', async () => {
    // Create a HOLD proposal with attacker data
    const proposal: PaymentProposal = {
      id: 'prop_attack_123',
      vendorId: null,
      vendorName: 'Unknown Corp',
      amount: 1200.0,
      currency: 'USD',
      payee: 'attacker-account@hacker.io',
      requestedPayeeInEmail: 'attacker-account@hacker.io',
      verdict: 'HOLD',
      flags: [
        {
          id: 'payee_change',
          severity: 'HIGH',
          title: 'Unverified Payee Change',
          evidence: 'Requested payment to attacker-account@hacker.io'
        }
      ],
      status: 'PENDING_REVIEW',
      requiresCallbackCheck: true,
      requiresAmountConfirm: true,
      isHardBlocked: false,
      callbackConfirmed: false,
      callbackNote: null,
      approvalNote: null,
      rejectionReason: null,
      paypalBatchId: null,
      paypalPayoutItemId: null,
      rawEmail: 'From: scammer@fraud-domain-xyz.com\nTo: accounts@mycompany.com\nSubject: Overdue Invoice\n\nPlease remit $1200 to attacker-account@hacker.io',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    repo.saveProposal(proposal);

    // Approver rejects with block checkboxes ON
    const rejectRes = await request(app)
      .post(`/api/proposals/${proposal.id}/reject`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        reason: 'Confirmed fraudulent invoice attempt',
        blockSenderDomain: true,
        blockPayeeIdentifiers: true
      });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe('REJECTED');

    // Verify blocked senders contains fraud-domain-xyz.com
    const blockedSenders = repo.getBlockedSenders();
    expect(blockedSenders.some(s => s.domain === 'fraud-domain-xyz.com')).toBe(true);

    // Verify blocked payees contains attacker-account@hacker.io
    const blockedPayees = repo.getBlockedPayees();
    expect(blockedPayees.some(p => p.identifier === 'attacker-account@hacker.io')).toBe(true);
  });

  it('evaluates future emails against blocklist, raising HIGH flags and forcing HOLD', async () => {
    // Manually block an attacker domain and payee
    repo.addBlockedSender(
      { domain: 'known-malicious-domain.com', reason: 'Repeated spear phishing', sourceProposalId: null },
      'security_admin'
    );
    repo.addBlockedPayee(
      { identifier: 'hacker-payout@shadow.io', reason: 'Flagged fraud receiver', sourceProposalId: null },
      'security_admin'
    );

    // Send check request for email from blocked domain
    const emailRes = await request(app)
      .post('/api/email/check')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        rawEmail: 'From: invoices@known-malicious-domain.com\nTo: finance@company.com\nSubject: Invoice #8899\n\nPlease pay $250 to hacker-payout@shadow.io'
      });

    expect(emailRes.status).toBe(200);
    const body = emailRes.body;
    expect(body.verdict).toBe('HOLD');

    const flagIds = body.flags.map((f: any) => f.id);
    expect(flagIds).toContain('blocklisted_sender');
    expect(flagIds).toContain('blocklisted_payee');

    const senderFlag = body.flags.find((f: any) => f.id === 'blocklisted_sender');
    expect(senderFlag.severity).toBe('HIGH');
    expect(senderFlag.evidence).toContain('known-malicious-domain.com');

    const payeeFlag = body.flags.find((f: any) => f.id === 'blocklisted_payee');
    expect(payeeFlag.severity).toBe('HIGH');
    expect(payeeFlag.evidence).toContain('hacker-payout@shadow.io');
  });
});
