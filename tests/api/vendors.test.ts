import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { config } from '../../src/server/config.js';

describe('Vendors Management API Endpoints', () => {
  const testDb = './data/test_vendors_api.db';
  let repo: SqliteRepository;
  let app: any;
  let authCookie: string[];

  beforeEach(async () => {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    repo = new SqliteRepository(testDb);
    app = createApp(repo);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ password: config.APP_PASSWORD });

    authCookie = loginRes.headers['set-cookie'] as unknown as string[];
  });

  afterEach(() => {
    repo.close();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  });

  it('creates and lists vendors', async () => {
    const createRes = await request(app)
      .post('/api/vendors')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        name: 'Office Pro Services',
        payeeEmail: 'billing@officepro.com',
        phone: '+1-555-0987',
        typicalAmount: 320.0,
        domains: ['officepro.com']
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe('Office Pro Services');

    const listRes = await request(app).get('/api/vendors').set('Cookie', authCookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].name).toBe('Office Pro Services');
  });

  it('updates payee on file with mandatory reason logged to audit', async () => {
    const createRes = await request(app)
      .post('/api/vendors')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        name: 'Apex Printing',
        payeeEmail: 'orders@apexprinting.com',
        domains: ['apexprinting.com']
      });

    const vendorId = createRes.body.id;

    // Fail if reason too short
    const shortReason = await request(app)
      .put(`/api/vendors/${vendorId}/payee`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ newPayee: 'new-orders@apexprinting.com', reason: 'ok' });

    expect(shortReason.status).toBe(400);

    // Succeed with valid reason
    const successRes = await request(app)
      .put(`/api/vendors/${vendorId}/payee`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        newPayee: 'new-orders@apexprinting.com',
        reason: 'Spoke directly with managing partner Bob on verified phone to confirm change'
      });

    expect(successRes.status).toBe(200);
    expect(successRes.body.paypalEmails[0]).toBe('new-orders@apexprinting.com');
  });

  it('downloads CSV template and imports valid CSV data', async () => {
    const templateRes = await request(app).get('/api/vendors/template.csv').set('Cookie', authCookie);
    expect(templateRes.status).toBe(200);
    expect(templateRes.headers['content-type']).toContain('text/csv');
    expect(templateRes.text).toContain('vendor,payee_email');

    const importRes = await request(app)
      .post('/api/vendors/import-csv')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ csvContent: templateRes.text });

    expect(importRes.status).toBe(200);
    expect(importRes.body.importedCount).toBeGreaterThanOrEqual(2);

    const listRes = await request(app).get('/api/vendors').set('Cookie', authCookie);
    expect(listRes.body.length).toBeGreaterThanOrEqual(2);
  });

  it('triggers sync history and updates records gracefully', async () => {
    const syncRes = await request(app)
      .post('/api/vendors/sync-paypal')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1');

    expect(syncRes.status).toBe(200);
    expect(syncRes.body.message).toBeDefined();
  });

  it('supports creating and updating vendor verified contactEmail with audit logging', async () => {
    const createRes = await request(app)
      .post('/api/vendors')
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({
        name: 'Contact Vendor Inc',
        payeeEmail: 'billing@contactvendor.com',
        contactEmail: 'security@contactvendor.com',
        domains: ['contactvendor.com']
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.contactEmail).toBe('security@contactvendor.com');

    const vendorId = createRes.body.id;

    // Update contact email
    const updateRes = await request(app)
      .put(`/api/vendors/${vendorId}/contact-email`)
      .set('Cookie', authCookie)
      .set('X-PayGuard-Request', '1')
      .send({ contactEmail: 'new-contact@contactvendor.com' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.contactEmail).toBe('new-contact@contactvendor.com');

    // Verify audit log
    const auditRes = await request(app)
      .get('/api/audit')
      .set('Cookie', authCookie);

    expect(auditRes.status).toBe(200);
    const log = auditRes.body.find((l: any) => l.action === 'VENDOR_CONTACT_EMAIL_UPDATED');
    expect(log).toBeDefined();
    expect(log.details.newContactEmail).toBe('new-contact@contactvendor.com');
  });
});
