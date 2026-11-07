import crypto from 'node:crypto';
import { SqliteRepository } from '../src/adapters/persistence/sqlite-repository.js';
import { RealPayPalClient } from '../src/adapters/paypal/real-paypal-client.js';
import { config } from '../src/server/config.js';
import { Vendor, PaymentRecord } from '../src/domain/types.js';

async function seed() {
  console.log('🌱 Starting PayGuard Agent database seeder...');
  const repo = new SqliteRepository(config.DB_PATH);

  const now = new Date();

  const sampleVendors: Vendor[] = [
    {
      id: 'ven_cloud_01',
      name: 'Reliable Cloud Inc',
      paypalEmails: ['billing@reliablecloud.com'],
      domains: ['reliablecloud.com'],
      phone: '+1-555-0199',
      typicalAmount: 450.0,
      paymentCount: 8,
      source: 'paypal',
      createdAt: new Date(now.getTime() - 120 * 86400000).toISOString(),
      updatedAt: now.toISOString()
    },
    {
      id: 'ven_logistics_02',
      name: 'Global Logistics Ltd',
      paypalEmails: ['payments@globallogistics.io'],
      domains: ['globallogistics.io'],
      phone: '+44-20-7946-0912',
      typicalAmount: 1200.0,
      paymentCount: 5,
      source: 'paypal',
      createdAt: new Date(now.getTime() - 90 * 86400000).toISOString(),
      updatedAt: now.toISOString()
    },
    {
      id: 'ven_apex_03',
      name: 'Apex Office Solutions',
      paypalEmails: ['apex-accounts@gmail.com'],
      domains: ['apexoffice.net'],
      phone: '+1-555-0188',
      typicalAmount: 275.5,
      paymentCount: 4,
      source: 'csv',
      createdAt: new Date(now.getTime() - 60 * 86400000).toISOString(),
      updatedAt: now.toISOString()
    },
    {
      id: 'ven_nordic_04',
      name: 'Nordic Hardware ApS',
      paypalEmails: ['finance@nordichardware.dk'],
      domains: ['nordichardware.dk'],
      phone: '+45-70-12-34-56',
      typicalAmount: 890.0,
      paymentCount: 6,
      source: 'paypal',
      createdAt: new Date(now.getTime() - 45 * 86400000).toISOString(),
      updatedAt: now.toISOString()
    },
    {
      id: 'ven_iberian_05',
      name: 'Iberian Digital SL',
      paypalEmails: ['facturacion@iberiandigital.es'],
      domains: ['iberiandigital.es'],
      phone: '+34-91-123-4567',
      typicalAmount: 650.0,
      paymentCount: 3,
      source: 'manual',
      createdAt: new Date(now.getTime() - 30 * 86400000).toISOString(),
      updatedAt: now.toISOString()
    }
  ];

  repo.runInTransaction(() => {
    for (const vendor of sampleVendors) {
      repo.saveVendor(vendor);

      // Create realistic historical payment records for each vendor
      for (let i = 1; i <= vendor.paymentCount; i++) {
        const daysAgo = i * 20;
        const record: PaymentRecord = {
          id: `pay_${vendor.id}_${i}`,
          vendorId: vendor.id,
          payeeEmail: vendor.paypalEmails[0],
          amount: vendor.typicalAmount,
          currency: 'USD',
          status: 'SUCCESS',
          paypalBatchId: `BATCH-HIST-${vendor.id.slice(-4)}-${i}`,
          paidAt: new Date(now.getTime() - daysAgo * 86400000).toISOString()
        };
        repo.savePaymentRecord(record);
      }
    }

    repo.addAuditLog({
      action: 'DATABASE_SEEDED',
      actor: 'seed_script',
      targetId: null,
      details: {
        vendorCount: sampleVendors.length,
        mode: config.PAYPAL_MODE
      }
    });
  });

  console.log(`✅ Seeded ${sampleVendors.length} trusted vendors and historical payments into ${config.DB_PATH}`);

  // In sandbox mode with SEED_RECIPIENTS configured: send real test payouts
  if (
    config.PAYPAL_MODE === 'sandbox' &&
    config.PAYPAL_CLIENT_ID &&
    config.PAYPAL_CLIENT_SECRET &&
    config.SEED_RECIPIENTS
  ) {
    const recipients = config.SEED_RECIPIENTS.split(',')
      .map(r => r.trim())
      .filter(r => r.includes('@'));

    if (recipients.length > 0) {
      console.log(`🚀 Real PayPal Sandbox mode detected. Dispatching real sandbox payouts to: ${recipients.join(', ')}...`);
      const client = new RealPayPalClient(config.PAYPAL_CLIENT_ID, config.PAYPAL_CLIENT_SECRET);

      for (const recipient of recipients) {
        try {
          const res = await client.createPayout({
            senderBatchId: 'SEED-' + crypto.randomUUID().slice(0, 10),
            emailSubject: 'PayGuard Agent Seed Verification Payout',
            items: [
              {
                receiver: recipient,
                amount: 1.0,
                currency: 'USD',
                note: 'Establishing PayPal Sandbox payment history for PayGuard Agent',
                senderItemId: 'item_' + crypto.randomUUID().slice(0, 8)
              }
            ]
          });
          console.log(`   ✓ Sandbox payout sent to ${recipient}: Batch ID = ${res.batchId} (${res.batchStatus})`);
        } catch (err: any) {
          console.warn(`   ⚠ Failed sending sandbox payout to ${recipient}: ${err.message}`);
        }
      }
    }
  }

  repo.close();
  console.log('🎉 Seeding complete!');
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
