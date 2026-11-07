import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { IRepository } from '../../application/ports/repository.js';
import {
  Vendor,
  PaymentProposal,
  PaymentRecord,
  AuditLogEntry,
  ProposalStatus
} from '../../domain/types.js';

export class SqliteRepository implements IRepository {
  private db: Database.Database;

  constructor(dbPath: string) {
    const resolvedPath = path.resolve(process.cwd(), dbPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS vendors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        paypal_emails TEXT NOT NULL,
        domains TEXT NOT NULL,
        phone TEXT,
        typical_amount REAL NOT NULL DEFAULT 0,
        payment_count INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        vendor_id TEXT,
        vendor_name TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        payee TEXT NOT NULL,
        requested_payee_in_email TEXT,
        verdict TEXT NOT NULL,
        flags TEXT NOT NULL,
        status TEXT NOT NULL,
        requires_callback_check INTEGER NOT NULL DEFAULT 0,
        requires_amount_confirm INTEGER NOT NULL DEFAULT 0,
        is_hard_blocked INTEGER NOT NULL DEFAULT 0,
        callback_confirmed INTEGER NOT NULL DEFAULT 0,
        callback_note TEXT,
        approval_note TEXT,
        rejection_reason TEXT,
        paypal_batch_id TEXT,
        paypal_payout_item_id TEXT,
        raw_email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        vendor_id TEXT NOT NULL,
        payee_email TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        paypal_batch_id TEXT,
        paid_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        target_id TEXT,
        details TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
      CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at);
      CREATE INDEX IF NOT EXISTS idx_payments_vendor ON payments(vendor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
    `;
    this.db.exec(schemaSql);
  }

  // --- VENDORS ---

  getVendorById(id: string): Vendor | null {
    const row = this.db.prepare('SELECT * FROM vendors WHERE id = ?').get(id) as any;
    return row ? this.mapVendorRow(row) : null;
  }

  findVendorByDomainOrName(domain: string, name?: string): Vendor | null {
    const cleanDomain = domain.toLowerCase().trim();
    const vendors = this.getAllVendors();

    if (cleanDomain) {
      const match = vendors.find(v =>
        v.domains.some(d => d.toLowerCase() === cleanDomain)
      );
      if (match) return match;
    }

    if (name) {
      const cleanName = name.toLowerCase().trim();
      const match = vendors.find(v =>
        v.name.toLowerCase() === cleanName || cleanName.includes(v.name.toLowerCase())
      );
      if (match) return match;
    }

    return null;
  }

  getAllVendors(): Vendor[] {
    const rows = this.db.prepare('SELECT * FROM vendors ORDER BY name ASC').all() as any[];
    return rows.map(r => this.mapVendorRow(r));
  }

  saveVendor(vendor: Vendor): void {
    const stmt = this.db.prepare(`
      INSERT INTO vendors (id, name, paypal_emails, domains, phone, typical_amount, payment_count, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        paypal_emails = excluded.paypal_emails,
        domains = excluded.domains,
        phone = excluded.phone,
        typical_amount = excluded.typical_amount,
        payment_count = excluded.payment_count,
        source = excluded.source,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      vendor.id,
      vendor.name,
      JSON.stringify(vendor.paypalEmails),
      JSON.stringify(vendor.domains),
      vendor.phone,
      vendor.typicalAmount,
      vendor.paymentCount,
      vendor.source,
      vendor.createdAt,
      vendor.updatedAt
    );
  }

  updateVendorPayee(vendorId: string, newPayee: string, actor: string, reason: string): void {
    this.runInTransaction(() => {
      const vendor = this.getVendorById(vendorId);
      if (!vendor) throw new Error(`Vendor ${vendorId} not found`);

      const oldEmails = [...vendor.paypalEmails];
      const cleanNewPayee = newPayee.trim().toLowerCase();

      // Put new payee at the front of the list
      const updatedList = [
        cleanNewPayee,
        ...vendor.paypalEmails.filter(e => e.toLowerCase() !== cleanNewPayee)
      ];

      vendor.paypalEmails = updatedList;
      vendor.updatedAt = new Date().toISOString();
      this.saveVendor(vendor);

      this.addAuditLog({
        action: 'VENDOR_PAYEE_UPDATED',
        actor,
        targetId: vendorId,
        details: {
          vendorName: vendor.name,
          oldPayees: oldEmails,
          newPayee: cleanNewPayee,
          reason
        }
      });
    });
  }

  deleteVendor(id: string): boolean {
    const res = this.db.prepare('DELETE FROM vendors WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // --- PROPOSALS ---

  getProposalById(id: string): PaymentProposal | null {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as any;
    return row ? this.mapProposalRow(row) : null;
  }

  getAllProposals(): PaymentProposal[] {
    const rows = this.db.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all() as any[];
    return rows.map(r => this.mapProposalRow(r));
  }

  saveProposal(proposal: PaymentProposal): void {
    const stmt = this.db.prepare(`
      INSERT INTO proposals (
        id, vendor_id, vendor_name, amount, currency, payee, requested_payee_in_email,
        verdict, flags, status, requires_callback_check, requires_amount_confirm,
        is_hard_blocked, callback_confirmed, callback_note, approval_note,
        rejection_reason, paypal_batch_id, paypal_payout_item_id, raw_email,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        vendor_id = excluded.vendor_id,
        vendor_name = excluded.vendor_name,
        amount = excluded.amount,
        currency = excluded.currency,
        payee = excluded.payee,
        requested_payee_in_email = excluded.requested_payee_in_email,
        verdict = excluded.verdict,
        flags = excluded.flags,
        status = excluded.status,
        requires_callback_check = excluded.requires_callback_check,
        requires_amount_confirm = excluded.requires_amount_confirm,
        is_hard_blocked = excluded.is_hard_blocked,
        callback_confirmed = excluded.callback_confirmed,
        callback_note = excluded.callback_note,
        approval_note = excluded.approval_note,
        rejection_reason = excluded.rejection_reason,
        paypal_batch_id = excluded.paypal_batch_id,
        paypal_payout_item_id = excluded.paypal_payout_item_id,
        raw_email = excluded.raw_email,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      proposal.id,
      proposal.vendorId,
      proposal.vendorName,
      proposal.amount,
      proposal.currency,
      proposal.payee,
      proposal.requestedPayeeInEmail,
      proposal.verdict,
      JSON.stringify(proposal.flags),
      proposal.status,
      proposal.requiresCallbackCheck ? 1 : 0,
      proposal.requiresAmountConfirm ? 1 : 0,
      proposal.isHardBlocked ? 1 : 0,
      proposal.callbackConfirmed ? 1 : 0,
      proposal.callbackNote,
      proposal.approvalNote,
      proposal.rejectionReason,
      proposal.paypalBatchId,
      proposal.paypalPayoutItemId,
      proposal.rawEmail,
      proposal.createdAt,
      proposal.updatedAt
    );
  }

  updateProposalStatus(
    id: string,
    status: ProposalStatus,
    extra?: Partial<PaymentProposal>
  ): void {
    const existing = this.getProposalById(id);
    if (!existing) throw new Error(`Proposal ${id} not found`);

    const updated: PaymentProposal = {
      ...existing,
      ...extra,
      status,
      updatedAt: new Date().toISOString()
    };
    this.saveProposal(updated);
  }

  // --- PAYMENTS ---

  getPaymentRecords(vendorId?: string): PaymentRecord[] {
    if (vendorId) {
      const rows = this.db.prepare(
        'SELECT * FROM payments WHERE vendor_id = ? ORDER BY paid_at DESC'
      ).all(vendorId) as any[];
      return rows.map(r => this.mapPaymentRow(r));
    }
    const rows = this.db.prepare('SELECT * FROM payments ORDER BY paid_at DESC').all() as any[];
    return rows.map(r => this.mapPaymentRow(r));
  }

  savePaymentRecord(payment: PaymentRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO payments (id, vendor_id, payee_email, amount, currency, status, paypal_batch_id, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      payment.id,
      payment.vendorId,
      payment.payeeEmail,
      payment.amount,
      payment.currency,
      payment.status,
      payment.paypalBatchId || null,
      payment.paidAt
    );
  }

  // --- AUDIT LOGS ---

  addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
    const id = 'audit_' + crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (id, action, actor, target_id, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      entry.action,
      entry.actor,
      entry.targetId,
      JSON.stringify(entry.details),
      timestamp
    );
  }

  getAuditLogs(limit: number = 100): AuditLogEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as any[];

    return rows.map(r => ({
      id: r.id,
      action: r.action,
      actor: r.actor,
      targetId: r.target_id,
      details: JSON.parse(r.details || '{}'),
      timestamp: r.timestamp
    }));
  }

  runInTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Row mappers
  private mapVendorRow(r: any): Vendor {
    return {
      id: r.id,
      name: r.name,
      paypalEmails: JSON.parse(r.paypal_emails || '[]'),
      domains: JSON.parse(r.domains || '[]'),
      phone: r.phone,
      typicalAmount: Number(r.typical_amount),
      paymentCount: Number(r.payment_count),
      source: r.source,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  private mapProposalRow(r: any): PaymentProposal {
    return {
      id: r.id,
      vendorId: r.vendor_id,
      vendorName: r.vendor_name,
      amount: Number(r.amount),
      currency: r.currency,
      payee: r.payee,
      requestedPayeeInEmail: r.requested_payee_in_email,
      verdict: r.verdict,
      flags: JSON.parse(r.flags || '[]'),
      status: r.status,
      requiresCallbackCheck: Boolean(r.requires_callback_check),
      requiresAmountConfirm: Boolean(r.requires_amount_confirm),
      isHardBlocked: Boolean(r.is_hard_blocked),
      callbackConfirmed: Boolean(r.callback_confirmed),
      callbackNote: r.callback_note,
      approvalNote: r.approval_note,
      rejectionReason: r.rejection_reason,
      paypalBatchId: r.paypal_batch_id,
      paypalPayoutItemId: r.paypal_payout_item_id,
      rawEmail: r.raw_email,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  private mapPaymentRow(r: any): PaymentRecord {
    return {
      id: r.id,
      vendorId: r.vendor_id,
      payeeEmail: r.payee_email,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      paypalBatchId: r.paypal_batch_id || undefined,
      paidAt: r.paid_at
    };
  }

  close(): void {
    this.db.close();
  }
}
