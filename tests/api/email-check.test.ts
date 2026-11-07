import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { SAMPLE_EMAILS } from '../../src/adapters/ai/sample-data.js';
import { config } from '../../src/server/config.js';

describe('Email Check API Endpoints', () => {
  const testDb = './data/test_email_check.db';
  let repo: SqliteRepository;
  let app: any;
  let authCookie: string[];

  beforeEach(async () => {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    repo = new SqliteRepository(testDb);
    app = createApp(repo);

    // Populate a trusted vendor record
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

  it('checks fraud sample with payee redirect and returns HOLD verdict with proposal', async () => {
    const fraudSample = SAMPLE_EMAILS.find(s => s.id === 'sample-fraud-new-payee')!;

    const res = await request(app)
      .post('/api/email/check')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ rawEmail: fraudSample.rawEmail });

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('HOLD');
    expect(res.body.proposal).not.toBeNull();
    // Critical: Proposal payee must be the ON FILE address, NOT the attacker's fastmail!
    expect(res.body.proposal.payee).toBe('billing@reliablecloud.com');
    expect(res.body.proposal.requestedPayeeInEmail).toContain('alice-payouts-temp@fastmail.com');
    expect(res.body.flags.some((f: any) => f.id === 'payee_change')).toBe(true);
  });

  it('checks honest cloud invoice and returns CLEAR with valid proposal', async () => {
    const honestSample = SAMPLE_EMAILS.find(s => s.id === 'sample-honest-invoice-1')!;

    const res = await request(app)
      .post('/api/email/check')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ rawEmail: honestSample.rawEmail });

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('CLEAR');
    expect(res.body.flags).toHaveLength(0);
    expect(res.body.proposal).not.toBeNull();
    expect(res.body.proposal.payee).toBe('billing@reliablecloud.com');
  });

  it('enforces 100 KB payload size limit', async () => {
    const oversizedEmail = 'A'.repeat(105 * 1024);

    const res = await request(app)
      .post('/api/email/check')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ rawEmail: oversizedEmail });

    expect([400, 413]).toContain(res.status);
  });
});
