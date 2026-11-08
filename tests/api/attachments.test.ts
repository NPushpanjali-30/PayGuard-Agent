import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { SAMPLE_EMAILS } from '../../src/adapters/ai/sample-data.js';
import { config } from '../../src/server/config.js';

describe('Attachment Analysis API Endpoints', () => {
  const testDb = './data/test_attachments.db';
  let repo: SqliteRepository;
  let app: any;
  let authCookie: string[];

  const honestPdfPath = path.resolve(process.cwd(), 'data/samples/sample-honest-invoice.pdf');
  const fraudPdfPath = path.resolve(process.cwd(), 'data/samples/sample-fraud-invoice.pdf');

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

  it('rejects files with invalid magic bytes (fake PDF)', async () => {
    const fakePdfBuffer = Buffer.from('NOT_A_REAL_PDF_FILE_HEADER');

    const res = await request(app)
      .post('/api/email/check-with-attachments')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .field('rawEmail', 'From: billing@reliablecloud.com\nSubject: Invoice\n\nBody')
      .attach('attachments', fakePdfBuffer, 'fake.pdf');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unsupported file format');
  });

  it('analyzes honest invoice PDF and returns CLEAR', async () => {
    const honestSample = SAMPLE_EMAILS.find(s => s.id === 'sample-honest-invoice-pdf')!;
    const pdfBuffer = fs.readFileSync(honestPdfPath);

    const res = await request(app)
      .post('/api/email/check-with-attachments')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .field('rawEmail', honestSample.rawEmail)
      .attach('attachments', pdfBuffer, 'sample-honest-invoice.pdf');

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('CLEAR');
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0].invoiceData.vendorName).toBe('Reliable Cloud Inc');
    expect(res.body.attachments[0].invoiceData.amount).toBe(450.0);
    expect(res.body.proposal).not.toBeNull();
    expect(res.body.proposal.payee).toBe('billing@reliablecloud.com');
  });

  it('catches fraud invoice PDF with payee mismatch and flags HOLD', async () => {
    const fraudSample = SAMPLE_EMAILS.find(s => s.id === 'sample-fraud-invoice-pdf')!;
    const pdfBuffer = fs.readFileSync(fraudPdfPath);

    const res = await request(app)
      .post('/api/email/check-with-attachments')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .field('rawEmail', fraudSample.rawEmail)
      .attach('attachments', pdfBuffer, 'sample-fraud-invoice.pdf');

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('HOLD');
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0].invoiceData.hiddenInstructionsDetected).toBe(true);

    const flagIds = res.body.flags.map((f: any) => f.id);
    expect(flagIds).toContain('attachment_payee_mismatch');
    expect(flagIds).toContain('attachment_new_payee');
    expect(flagIds).toContain('attachment_hidden_instructions');

    // Proposal payee must stay locked to the verified vendor record, not the attacker's payee!
    expect(res.body.proposal.payee).toBe('billing@reliablecloud.com');
  });

  it('rejects more than 3 attachments', async () => {
    const pdfBuffer = fs.readFileSync(honestPdfPath);

    const res = await request(app)
      .post('/api/email/check-with-attachments')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .field('rawEmail', 'From: test@example.com\nSubject: Test\n\nBody')
      .attach('attachments', pdfBuffer, 'file1.pdf')
      .attach('attachments', pdfBuffer, 'file2.pdf')
      .attach('attachments', pdfBuffer, 'file3.pdf')
      .attach('attachments', pdfBuffer, 'file4.pdf');

    expect([400, 500]).toContain(res.status);
  });
});
