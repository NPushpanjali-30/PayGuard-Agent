import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { config } from '../../src/server/config.js';
import { HONEST_SAMPLE_PDF_BASE64 } from '../../src/adapters/ai/sample-data.js';

describe('Zapier / Webhook Email Intake API', () => {
  const testDb = './data/test_intake.db';
  let repo: SqliteRepository;
  let app: any;
  const TEST_INTAKE_KEY = 'secret-test-intake-api-key-999';

  beforeEach(() => {
    if (fs.existsSync(testDb)) {
      try {
        fs.unlinkSync(testDb);
      } catch {}
    }
    repo = new SqliteRepository(testDb);

    // Seed a trusted vendor
    repo.saveVendor({
      id: 'v_cloud',
      name: 'Reliable Cloud Inc',
      paypalEmails: ['billing@reliablecloud.com'],
      domains: ['reliablecloud.com'],
      phone: '+1-555-0199',
      contactEmail: 'security@reliablecloud.com',
      typicalAmount: 450.0,
      paymentCount: 8,
      source: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    config.INTAKE_API_KEY = TEST_INTAKE_KEY;
    app = createApp(repo);
  });

  afterEach(() => {
    repo.close();
    if (fs.existsSync(testDb)) {
      try {
        fs.unlinkSync(testDb);
      } catch {}
    }
    config.INTAKE_API_KEY = '';
  });

  it('returns 403 Forbidden when INTAKE_API_KEY is not configured', async () => {
    config.INTAKE_API_KEY = '';

    const res = await request(app)
      .post('/api/intake/email')
      .set('X-Intake-Key', TEST_INTAKE_KEY)
      .send({
        from: 'billing@reliablecloud.com',
        body: 'Please pay invoice'
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Intake endpoint is disabled');
  });

  it('returns 401 Unauthorized when X-Intake-Key header is invalid or missing', async () => {
    // Missing header
    const resNoHeader = await request(app)
      .post('/api/intake/email')
      .send({
        from: 'billing@reliablecloud.com',
        body: 'Please pay invoice'
      });
    expect(resNoHeader.status).toBe(401);

    // Wrong header
    const resWrongHeader = await request(app)
      .post('/api/intake/email')
      .set('X-Intake-Key', 'wrong-key-123')
      .send({
        from: 'billing@reliablecloud.com',
        body: 'Please pay invoice'
      });
    expect(resWrongHeader.status).toBe(401);
  });

  it('processes incoming email JSON and creates a proposal with zapier_intake source', async () => {
    const res = await request(app)
      .post('/api/intake/email')
      .set('X-Intake-Key', TEST_INTAKE_KEY)
      .send({
        from: 'billing@reliablecloud.com',
        to: 'ap@mycompany.com',
        subject: 'Monthly Cloud Infrastructure - November 2026',
        body: 'Hello team, attached is the regular invoice for $450.00 USD. Pay to billing@reliablecloud.com.',
        messageId: 'gmail_msg_001'
      });

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBeDefined();
    expect(res.body.proposalId).toBeDefined();
    expect(res.body.url).toContain(`/proposals/${res.body.proposalId}`);

    // Verify proposal in database
    const proposal = repo.getProposalById(res.body.proposalId);
    expect(proposal).not.toBeNull();
    expect(proposal?.source).toBe('zapier_intake');
    expect(proposal?.status).toBe('PENDING_REVIEW'); // Never auto-paid!
    expect(proposal?.amount).toBe(450.0);

    // Verify audit log
    const auditLogs = repo.getAuditLogs();
    const intakeLog = auditLogs.find(l => l.action === 'EMAIL_INTAKE_RECEIVED');
    expect(intakeLog).toBeDefined();
    expect(intakeLog?.actor).toBe('zapier_intake');
  });

  it('ensures idempotency when same messageId is ingested twice', async () => {
    const emailPayload = {
      from: 'billing@reliablecloud.com',
      to: 'ap@mycompany.com',
      subject: 'Idempotency Test Invoice',
      body: 'Invoice for $450.00 USD to billing@reliablecloud.com.',
      messageId: 'unique_msg_id_9999'
    };

    // First ingestion
    const res1 = await request(app)
      .post('/api/intake/email')
      .set('X-Intake-Key', TEST_INTAKE_KEY)
      .send(emailPayload);

    expect(res1.status).toBe(200);
    const firstProposalId = res1.body.proposalId;
    const initialProposalCount = repo.getAllProposals().length;

    // Second ingestion with same messageId
    const res2 = await request(app)
      .post('/api/intake/email')
      .set('X-Intake-Key', TEST_INTAKE_KEY)
      .send(emailPayload);

    expect(res2.status).toBe(200);
    expect(res2.body.proposalId).toBe(firstProposalId);
    expect(res2.body.verdict).toBe(res1.body.verdict);

    // No duplicate proposal created
    const finalProposalCount = repo.getAllProposals().length;
    expect(finalProposalCount).toBe(initialProposalCount);
  });

  it('supports base64 invoice attachments and evaluates attachment rules', async () => {
    const res = await request(app)
      .post('/api/intake/email')
      .set('X-Intake-Key', TEST_INTAKE_KEY)
      .send({
        from: 'billing@reliablecloud.com',
        to: 'ap@mycompany.com',
        subject: 'Monthly Cloud Hosting Invoice #INV-2026-8842',
        body: 'Please find attached our regular monthly hosting invoice #INV-2026-8842 for $450.00 USD. Payment can be remitted to billing@reliablecloud.com as usual.',
        messageId: 'msg_with_pdf_1',
        attachments: [
          {
            filename: 'sample-honest-invoice.pdf',
            mimeType: 'application/pdf',
            contentBase64: HONEST_SAMPLE_PDF_BASE64
          }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.proposalId).toBeDefined();
    expect(res.body.verdict).toBe('CLEAR');
  });

  it('supports multipart form-data upload with attachment file', async () => {
    const sampleBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

    const res = await request(app)
      .post('/api/intake/email')
      .set('X-Intake-Key', TEST_INTAKE_KEY)
      .field('from', 'billing@reliablecloud.com')
      .field('to', 'ap@mycompany.com')
      .field('subject', 'Multipart Invoice Test')
      .field('body', 'Monthly billing for $450.00 USD.')
      .field('messageId', 'msg_multipart_1')
      .attach('attachments', sampleBuffer, 'sample.pdf');

    expect(res.status).toBe(200);
    expect(res.body.proposalId).toBeDefined();
  });
});
