import request from 'supertest';
import { createApp } from '../src/server/app.js';
import { SqliteRepository } from '../src/adapters/persistence/sqlite-repository.js';
import { SAMPLE_EMAILS } from '../src/adapters/ai/sample-data.js';
import { config } from '../src/server/config.js';

async function verifyE2E() {
  console.log('🚀 Running End-to-End Definition-of-Done Verification (Mock Mode, Fresh DB)...');

  const repo = new SqliteRepository('./data/payguard.db');
  const app = createApp(repo);

  // 1. Authenticate / Login
  console.log('1. Testing Login with APP_PASSWORD...');
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ password: config.APP_PASSWORD });

  if (loginRes.status !== 200 || !loginRes.body.authenticated) {
    throw new Error(`Login failed with status ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
  }
  const cookie = loginRes.headers['set-cookie'] as unknown as string[];
  console.log('   ✓ Logged in successfully! Received signed session cookie.');

  // 2. Check Fraud Sample (Expect HOLD)
  console.log('2. Checking Fraud Sample (Expect HOLD)...');
  const fraudSample = SAMPLE_EMAILS.find(s => s.id === 'sample-fraud-new-payee')!;
  const fraudRes = await request(app)
    .post('/api/email/check')
    .set('Cookie', cookie)
    .set('X-PayGuard-Request', '1')
    .send({ rawEmail: fraudSample.rawEmail });

  if (fraudRes.status !== 200) {
    throw new Error(`Check fraud failed: ${JSON.stringify(fraudRes.body)}`);
  }
  if (fraudRes.body.verdict !== 'HOLD') {
    throw new Error(`Expected verdict HOLD for fraud, got: ${fraudRes.body.verdict}`);
  }
  console.log(`   ✓ Fraud sample intercepted: VERDICT = ${fraudRes.body.verdict}`);
  console.log(`     Flags: ${fraudRes.body.flags.map((f: any) => f.id).join(', ')}`);
  console.log(`     Payee locked to record: ${fraudRes.body.proposal.payee}`);

  // 3. Check Honest Sample (Expect CLEAR or CHECK)
  console.log('3. Checking Honest Sample (Expect CLEAR or CHECK)...');
  const honestSample = SAMPLE_EMAILS.find(s => s.id === 'sample-honest-invoice-1')!;
  const honestRes = await request(app)
    .post('/api/email/check')
    .set('Cookie', cookie)
    .set('X-PayGuard-Request', '1')
    .send({ rawEmail: honestSample.rawEmail });

  if (honestRes.status !== 200) {
    throw new Error(`Check honest failed: ${JSON.stringify(honestRes.body)}`);
  }
  if (!['CLEAR', 'CHECK'].includes(honestRes.body.verdict)) {
    throw new Error(`Expected verdict CLEAR or CHECK for honest invoice, got: ${honestRes.body.verdict}`);
  }
  console.log(`   ✓ Honest sample processed: VERDICT = ${honestRes.body.verdict}`);
  const proposalId = honestRes.body.proposal.id;

  // 4. Approve the honest proposal in Mock mode
  console.log(`4. Approving honest proposal ${proposalId} via PayPal Payouts...`);
  const approveRes = await request(app)
    .post(`/api/proposals/${proposalId}/approve`)
    .set('Cookie', cookie)
    .set('X-PayGuard-Request', '1')
    .send({ approvalNote: 'Approved for automated disbursement' });

  if (approveRes.status !== 200) {
    throw new Error(`Approval failed: ${JSON.stringify(approveRes.body)}`);
  }
  console.log(`   ✓ Proposal approved! Initial status = ${approveRes.body.status}, Batch ID = ${approveRes.body.paypalBatchId}`);

  // 5. Poll until status reaches PAID
  console.log('5. Polling proposal until status reaches PAID...');
  let currentStatus = approveRes.body.status;
  let attempts = 0;
  while (currentStatus !== 'PAID' && attempts < 10) {
    await new Promise(r => setTimeout(r, 600));
    const pollRes = await request(app)
      .get(`/api/proposals/${proposalId}/poll`)
      .set('Cookie', cookie);
    currentStatus = pollRes.body.status;
    attempts++;
  }

  if (currentStatus !== 'PAID') {
    throw new Error(`Proposal did not reach PAID within timeout. Current status: ${currentStatus}`);
  }
  console.log(`   ✓ Confirmed: Proposal status reached PAID! PayPal Batch completed successfully.`);

  repo.close();
  console.log('\n🎉 ALL DEFINITION-OF-DONE VERIFICATION CHECKS PASSED!');
}

verifyE2E().catch(err => {
  console.error('❌ E2E Verification failed:', err);
  process.exit(1);
});
