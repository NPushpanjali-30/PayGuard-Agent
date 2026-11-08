import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { config } from '../../src/server/config.js';

describe('Auth & Session API', () => {
  const testDb = './data/test_auth.db';
  let repo: SqliteRepository;
  let app: any;

  beforeEach(() => {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    repo = new SqliteRepository(testDb);
    app = createApp(repo);
  });

  afterEach(() => {
    repo.close();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  });

  it('rejects unauthenticated requests to protected endpoints', async () => {
    const res = await request(app).get('/api/vendors');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Authentication required');
  });

  it('authenticates with correct APP_PASSWORD and sets signed session cookie', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ password: config.APP_PASSWORD });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.authenticated).toBe(true);
    expect(loginRes.headers['set-cookie']).toBeDefined();
    expect(loginRes.headers['set-cookie'][0]).toContain('payguard_session');
  });

  it('rejects incorrect password attempt', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid password');
  });

  it('blocks mutating actions without CSRF header', async () => {
    // 1. Login to get cookie
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ password: config.APP_PASSWORD });

    const cookie = loginRes.headers['set-cookie'];

    // 2. Attempt POST without X-PayGuard-Request header
    const postRes = await request(app)
      .post('/api/vendors')
      .set('Cookie', cookie)
      .send({ name: 'Test', payeeEmail: 'test@example.com' });

    expect(postRes.status).toBe(403);
    expect(postRes.body.error).toContain('Missing anti-CSRF request header');

    // 3. Attempt POST WITH X-PayGuard-Request header
    const okRes = await request(app)
      .post('/api/vendors')
      .set('Cookie', cookie)
      .set('X-PayGuard-Request', '1')
      .send({ name: 'Test Supplier', payeeEmail: 'test@supplier.com' });

    expect(okRes.status).toBe(201);
  });

  it('returns authenticated user identity from /api/auth/me', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'approver', password: config.APP_PASSWORD });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user).toBe('approver');

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', loginRes.headers['set-cookie']);

    expect(meRes.status).toBe(200);
    expect(meRes.body.authenticated).toBe(true);
    expect(meRes.body.user).toBe('approver');
  });

  it('supports multi-approver authentication when configured', async () => {
    // Configure approvers
    config.approversMap.set('alice', 'alicePass123!');
    config.approversMap.set('bob', 'bobPass456!');

    const aliceRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'alicePass123!' });

    expect(aliceRes.status).toBe(200);
    expect(aliceRes.body.user).toBe('alice');

    const meAlice = await request(app)
      .get('/api/auth/me')
      .set('Cookie', aliceRes.headers['set-cookie']);
    expect(meAlice.body.user).toBe('alice');

    // Wrong password for bob
    const bobFail = await request(app)
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'wrong' });
    expect(bobFail.status).toBe(401);
  });
});
