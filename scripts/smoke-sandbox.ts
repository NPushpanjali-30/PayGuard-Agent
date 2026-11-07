/**
 * Manual smoke testing script for real PayPal Sandbox API integration.
 *
 * Usage:
 * 1. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env
 * 2. Set SEED_RECIPIENTS to a personal sandbox account email (e.g. sb-user@personal.example.com)
 * 3. Run: npm run smoke:sandbox
 */

import crypto from 'node:crypto';
import { RealPayPalClient } from '../src/adapters/paypal/real-paypal-client.js';
import { config } from '../src/server/config.js';

async function main() {
  console.log('🧪 Starting PayPal Sandbox Smoke Test...');

  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET) {
    console.error('❌ Missing PayPal Sandbox credentials in .env.');
    console.error('   Please provide PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
    process.exit(1);
  }

  const recipient = config.SEED_RECIPIENTS?.split(',')[0]?.trim();
  if (!recipient || !recipient.includes('@')) {
    console.error('❌ Missing recipient email. Set SEED_RECIPIENTS in .env with a sandbox buyer account.');
    process.exit(1);
  }

  console.log(`Connecting to PayPal Sandbox with Client ID: ${config.PAYPAL_CLIENT_ID.slice(0, 8)}...`);
  const client = new RealPayPalClient(config.PAYPAL_CLIENT_ID, config.PAYPAL_CLIENT_SECRET);

  // 1. Authenticate and retrieve OAuth Token
  console.log('1. Requesting OAuth2 Access Token...');
  const token = await client.getAccessToken();
  console.log(`✓ Token retrieved successfully: ${token.slice(0, 15)}... (cached)`);

  // 2. Dispatch a minimal $1.00 Sandbox Payout
  const batchId = 'SMOKE-' + crypto.randomUUID().slice(0, 10);
  console.log(`2. Dispatching test payout to: ${recipient} (Batch ID: ${batchId})...`);

  const payoutResult = await client.createPayout({
    senderBatchId: batchId,
    emailSubject: 'PayGuard Agent Sandbox Smoke Test',
    items: [
      {
        receiver: recipient,
        amount: 1.0,
        currency: 'USD',
        note: 'Live Sandbox verification for PayGuard Agent',
        senderItemId: 'smoke_item_' + crypto.randomUUID().slice(0, 8)
      }
    ]
  });

  console.log(`✓ Payout created!`);
  console.log(`   PayPal Payout Batch ID: ${payoutResult.batchId}`);
  console.log(`   Initial Status:        ${payoutResult.batchStatus}`);

  // 3. Poll batch status after a brief delay
  console.log('3. Waiting 3 seconds to poll final batch status...');
  await new Promise(r => setTimeout(r, 3000));

  const polled = await client.getPayoutBatchStatus(payoutResult.batchId);
  console.log(`✓ Batch Status Result:   ${polled.batchStatus}`);
  console.log('\n🎉 Real PayPal Sandbox Smoke Test Complete!');
}

main().catch(err => {
  console.error('\n❌ Smoke test failed:', err.message);
  process.exit(1);
});
