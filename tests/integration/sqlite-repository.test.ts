import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteRepository } from '../../src/adapters/persistence/sqlite-repository.js';
import { Vendor, PaymentProposal } from '../../src/domain/types.js';

describe('SqliteRepository Integration Tests', () => {
  const testDbPath = './data/test_payguard.db';
  let repo: SqliteRepository;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    repo = new SqliteRepository(testDbPath);
  });

  afterEach(() => {
    repo.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('saves and retrieves vendor records', () => {
    const vendor: Vendor = {
      id: 'v_test1',
      name: 'Test Supplier Inc',
      paypalEmails: ['billing@testsupplier.com'],
      domains: ['testsupplier.com'],
      phone: '+1-555-0199',
      typicalAmount: 350.0,
      paymentCount: 5,
      source: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    repo.saveVendor(vendor);

    const retrieved = repo.getVendorById('v_test1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe('Test Supplier Inc');
    expect(retrieved?.paypalEmails).toContain('billing@testsupplier.com');
    expect(retrieved?.domains).toContain('testsupplier.com');

    const byDomain = repo.findVendorByDomainOrName('testsupplier.com');
    expect(byDomain?.id).toBe('v_test1');
  });

  it('updates vendor payee and appends audit log entry', () => {
    const vendor: Vendor = {
      id: 'v_test2',
      name: 'Acme Logistics',
      paypalEmails: ['old@acme.com'],
      domains: ['acme.com'],
      phone: '+1-555-0100',
      typicalAmount: 500,
      paymentCount: 2,
      source: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    repo.saveVendor(vendor);

    repo.updateVendorPayee('v_test2', 'new@acme.com', 'admin_user', 'Verified via phone call to Alice');

    const updated = repo.getVendorById('v_test2');
    expect(updated?.paypalEmails[0]).toBe('new@acme.com');
    expect(updated?.paypalEmails).toContain('old@acme.com');

    const auditLogs = repo.getAuditLogs();
    const updateLog = auditLogs.find(l => l.action === 'VENDOR_PAYEE_UPDATED');
    expect(updateLog).toBeDefined();
    expect(updateLog?.actor).toBe('admin_user');
    expect((updateLog?.details as any).newPayee).toBe('new@acme.com');
  });

  it('saves and updates proposals atomically', () => {
    const proposal: PaymentProposal = {
      id: 'prop_test1',
      vendorId: 'v_test1',
      vendorName: 'Test Supplier Inc',
      amount: 450,
      currency: 'USD',
      payee: 'billing@testsupplier.com',
      requestedPayeeInEmail: null,
      verdict: 'CLEAR',
      flags: [],
      status: 'PENDING_REVIEW',
      requiresCallbackCheck: false,
      requiresAmountConfirm: false,
      isHardBlocked: false,
      callbackConfirmed: false,
      callbackNote: null,
      approvalNote: null,
      rejectionReason: null,
      paypalBatchId: null,
      paypalPayoutItemId: null,
      rawEmail: 'Email body...',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    repo.saveProposal(proposal);

    const fetched = repo.getProposalById('prop_test1');
    expect(fetched?.status).toBe('PENDING_REVIEW');

    repo.updateProposalStatus('prop_test1', 'PAID', {
      paypalBatchId: 'BATCH_123',
      approvalNote: 'Approved on 11/07'
    });

    const updated = repo.getProposalById('prop_test1');
    expect(updated?.status).toBe('PAID');
    expect(updated?.paypalBatchId).toBe('BATCH_123');
    expect(updated?.approvalNote).toBe('Approved on 11/07');
  });
});
