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
  ProposalStatus,
  VendorConfirmation,
  ConfirmationStatus,
  BlockedSender,
  BlockedPayee
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
        contact_email TEXT,
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
        payee TEXT,
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
        updated_at TEXT NOT NULL,
        requires_dual_approval INTEGER NOT NULL DEFAULT 0,
        first_approver TEXT,
        first_approved_at TEXT,
        second_approver TEXT,
        second_approved_at TEXT,
        cooling_off_until TEXT,
        cooling_off_bypassed INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual'
      );

      CREATE TABLE IF NOT EXISTS intake_messages (
        message_id TEXT PRIMARY KEY,
        proposal_id TEXT,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
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

      CREATE TABLE IF NOT EXISTS confirmations (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        vendor_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        sent_to TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'CONFIRMED', 'DENIED', 'EXPIRED')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT,
        FOREIGN KEY(proposal_id) REFERENCES proposals(id),
        FOREIGN KEY(vendor_id) REFERENCES vendors(id)
      );

      CREATE TABLE IF NOT EXISTS blocked_senders (
        id TEXT PRIMARY KEY,
        domain TEXT,
        address TEXT,
        reason TEXT NOT NULL,
        source_proposal_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS blocked_payees (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        source_proposal_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
      CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at);
      CREATE INDEX IF NOT EXISTS idx_payments_vendor ON payments(vendor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_confirmations_token_hash ON confirmations(token_hash);
      CREATE INDEX IF NOT EXISTS idx_confirmations_proposal_id ON confirmations(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_blocked_senders_domain ON blocked_senders(domain);
      CREATE INDEX IF NOT EXISTS idx_blocked_senders_address ON blocked_senders(address);
      CREATE INDEX IF NOT EXISTS idx_blocked_payees_identifier ON blocked_payees(identifier);
    `;
    this.db.exec(schemaSql);

    // Migration: ensure contact_email exists in existing databases
    const vendorColumns = this.db.prepare("PRAGMA table_info(vendors)").all() as Array<{ name: string }>;
    if (!vendorColumns.some(c => c.name === 'contact_email')) {
      this.db.exec("ALTER TABLE vendors ADD COLUMN contact_email TEXT");
    }

    // Migration: ensure dual approval & cooling off columns exist in existing proposals table
    const proposalColumns = this.db.prepare("PRAGMA table_info(proposals)").all() as Array<{ name: string }>;
    if (!proposalColumns.some(c => c.name === 'requires_dual_approval')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN requires_dual_approval INTEGER NOT NULL DEFAULT 0");
    }
    if (!proposalColumns.some(c => c.name === 'first_approver')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN first_approver TEXT");
    }
    if (!proposalColumns.some(c => c.name === 'first_approved_at')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN first_approved_at TEXT");
    }
    if (!proposalColumns.some(c => c.name === 'second_approver')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN second_approver TEXT");
    }
    if (!proposalColumns.some(c => c.name === 'second_approved_at')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN second_approved_at TEXT");
    }
    if (!proposalColumns.some(c => c.name === 'cooling_off_until')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN cooling_off_until TEXT");
    }
    if (!proposalColumns.some(c => c.name === 'cooling_off_bypassed')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN cooling_off_bypassed INTEGER NOT NULL DEFAULT 0");
    }
    if (!proposalColumns.some(c => c.name === 'source')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
    }
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
      INSERT INTO vendors (id, name, paypal_emails, domains, phone, contact_email, typical_amount, payment_count, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        paypal_emails = excluded.paypal_emails,
        domains = excluded.domains,
        phone = excluded.phone,
        contact_email = excluded.contact_email,
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
      vendor.contactEmail ?? null,
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

  updateVendorContactEmail(vendorId: string, contactEmail: string | null, actor: string): void {
    this.runInTransaction(() => {
      const vendor = this.getVendorById(vendorId);
      if (!vendor) throw new Error(`Vendor ${vendorId} not found`);

      const oldContactEmail = vendor.contactEmail ?? null;
      const cleanContactEmail = contactEmail && contactEmail.trim().length > 0 ? contactEmail.trim().toLowerCase() : null;

      vendor.contactEmail = cleanContactEmail;
      vendor.updatedAt = new Date().toISOString();
      this.saveVendor(vendor);

      this.addAuditLog({
        action: 'VENDOR_CONTACT_EMAIL_UPDATED',
        actor,
        targetId: vendorId,
        details: {
          vendorName: vendor.name,
          oldContactEmail,
          newContactEmail: cleanContactEmail
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
        created_at, updated_at, requires_dual_approval, first_approver,
        first_approved_at, second_approver, second_approved_at,
        cooling_off_until, cooling_off_bypassed, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        updated_at = excluded.updated_at,
        requires_dual_approval = excluded.requires_dual_approval,
        first_approver = excluded.first_approver,
        first_approved_at = excluded.first_approved_at,
        second_approver = excluded.second_approver,
        second_approved_at = excluded.second_approved_at,
        cooling_off_until = excluded.cooling_off_until,
        cooling_off_bypassed = excluded.cooling_off_bypassed,
        source = excluded.source
    `);

    stmt.run(
      proposal.id,
      proposal.vendorId,
      proposal.vendorName,
      proposal.amount,
      proposal.currency,
      proposal.payee ?? '',
      proposal.requestedPayeeInEmail,
      proposal.verdict,
      JSON.stringify(proposal.flags || []),
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
      proposal.updatedAt,
      proposal.requiresDualApproval ? 1 : 0,
      proposal.firstApprover || null,
      proposal.firstApprovedAt || null,
      proposal.secondApprover || null,
      proposal.secondApprovedAt || null,
      proposal.coolingOffUntil || null,
      proposal.coolingOffBypassed ? 1 : 0,
      proposal.source || 'manual'
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
           INSERT OR REPLACE INTO payments (id, vendor_id, payee_email, amount, currency, status, paypal_batch_id, paid_at)
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

  // --- CONFIRMATIONS ---

  saveConfirmation(c: VendorConfirmation): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO confirmations (
        id, proposal_id, vendor_id, token_hash, sent_to, status, created_at, expires_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      c.id,
      c.proposalId,
      c.vendorId,
      c.tokenHash,
      c.sentTo,
      c.status,
      c.createdAt,
      c.expiresAt,
      c.resolvedAt
    );
  }

  getConfirmationById(id: string): VendorConfirmation | null {
    const row = this.db.prepare('SELECT * FROM confirmations WHERE id = ?').get(id) as any;
    return row ? this.mapConfirmationRow(row) : null;
  }

  getConfirmationByTokenHash(tokenHash: string): VendorConfirmation | null {
    const row = this.db.prepare('SELECT * FROM confirmations WHERE token_hash = ?').get(tokenHash) as any;
    return row ? this.mapConfirmationRow(row) : null;
  }

  getConfirmationByProposalId(proposalId: string): VendorConfirmation | null {
    const row = this.db
      .prepare('SELECT * FROM confirmations WHERE proposal_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(proposalId) as any;
    return row ? this.mapConfirmationRow(row) : null;
  }

  updateConfirmStatus(id: string, status: ConfirmationStatus, resolvedAt: string | null): void {
    this.db
      .prepare('UPDATE confirmations SET status = ?, resolved_at = ? WHERE id = ?')
      .run(status, resolvedAt, id);
  }

  runInTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Row mappers
  private mapConfirmationRow(r: any): VendorConfirmation {
    return {
      id: r.id,
      proposalId: r.proposal_id,
      vendorId: r.vendor_id,
      tokenHash: r.token_hash,
      sentTo: r.sent_to,
      status: r.status as ConfirmationStatus,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      resolvedAt: r.resolved_at || null
    };
  }
  private mapVendorRow(r: any): Vendor {
    return {
      id: r.id,
      name: r.name,
      paypalEmails: JSON.parse(r.paypal_emails || '[]'),
      domains: JSON.parse(r.domains || '[]'),
      phone: r.phone,
      contactEmail: r.contact_email || null,
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
      payee: r.payee && r.payee.trim() !== '' ? r.payee : null,
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
      updatedAt: r.updated_at,
      requiresDualApproval: Boolean(r.requires_dual_approval),
      firstApprover: r.first_approver || null,
      firstApprovedAt: r.first_approved_at || null,
      secondApprover: r.second_approver || null,
      secondApprovedAt: r.second_approved_at || null,
      coolingOffUntil: r.cooling_off_until || null,
      coolingOffBypassed: Boolean(r.cooling_off_bypassed),
      source: (r.source as any) || 'manual'
    };
  }

  // --- INTAKE MESSAGES IDEMPOTENCY ---

  getIntakeMessage(messageId: string): { messageId: string; proposalId: string; resultJson: string; createdAt: string } | null {
    const row = this.db.prepare('SELECT * FROM intake_messages WHERE message_id = ?').get(messageId) as any;
    if (!row) return null;
    return {
      messageId: row.message_id,
      proposalId: row.proposal_id,
      resultJson: row.result_json,
      createdAt: row.created_at
    };
  }

  saveIntakeMessage(messageId: string, proposalId: string, resultJson: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO intake_messages (message_id, proposal_id, result_json, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(messageId, proposalId, resultJson, new Date().toISOString());
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

  // --- BLOCKLIST ---

  getBlockedSenders(): BlockedSender[] {
    const rows = this.db.prepare('SELECT * FROM blocked_senders ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      domain: r.domain || null,
      address: r.address || null,
      reason: r.reason,
      sourceProposalId: r.source_proposal_id || null,
      createdAt: r.created_at
    }));
  }

  getBlockedPayees(): BlockedPayee[] {
    const rows = this.db.prepare('SELECT * FROM blocked_payees ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      identifier: r.identifier,
      reason: r.reason,
      sourceProposalId: r.source_proposal_id || null,
      createdAt: r.created_at
    }));
  }

  addBlockedSender(entry: Omit<BlockedSender, 'id' | 'createdAt'>, actor: string): BlockedSender {
    // NEVER allow blocking a domain or payee that belongs to a vendor on file; show an error if attempted.
    const vendors = this.getAllVendors();
    for (const vendor of vendors) {
      if (entry.domain) {
        const dom = entry.domain.toLowerCase().trim();
        if (vendor.domains.some(d => d.toLowerCase().trim() === dom)) {
          throw new Error(`Cannot block domain '${entry.domain}' belonging to verified vendor on file: ${vendor.name}`);
        }
      }
      if (entry.address) {
        const addr = entry.address.toLowerCase().trim();
        if (vendor.contactEmail && vendor.contactEmail.toLowerCase().trim() === addr) {
          throw new Error(`Cannot block address '${entry.address}' belonging to verified vendor on file: ${vendor.name}`);
        }
        if (vendor.paypalEmails.some(e => e.toLowerCase().trim() === addr)) {
          throw new Error(`Cannot block address '${entry.address}' belonging to verified vendor on file: ${vendor.name}`);
        }
        const addrDomain = addr.split('@')[1];
        if (addrDomain && vendor.domains.some(d => d.toLowerCase().trim() === addrDomain)) {
          throw new Error(`Cannot block address '${entry.address}' from verified vendor domain on file: ${vendor.name}`);
        }
      }
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO blocked_senders (id, domain, address, reason, source_proposal_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, entry.domain ? entry.domain.trim() : null, entry.address ? entry.address.trim() : null, entry.reason, entry.sourceProposalId || null, createdAt);

    this.addAuditLog({
      action: 'SENDER_BLOCKED',
      actor,
      targetId: id,
      details: {
        domain: entry.domain,
        address: entry.address,
        reason: entry.reason,
        sourceProposalId: entry.sourceProposalId
      }
    });

    return {
      id,
      domain: entry.domain || null,
      address: entry.address || null,
      reason: entry.reason,
      sourceProposalId: entry.sourceProposalId || null,
      createdAt
    };
  }

  addBlockedPayee(entry: Omit<BlockedPayee, 'id' | 'createdAt'>, actor: string): BlockedPayee {
    // NEVER allow blocking a payee that belongs to a vendor on file; show an error if attempted.
    const vendors = this.getAllVendors();
    const targetIdent = entry.identifier.toLowerCase().trim();
    for (const vendor of vendors) {
      if (vendor.paypalEmails.some(e => e.toLowerCase().trim() === targetIdent)) {
        throw new Error(`Cannot block payee identifier '${entry.identifier}' belonging to verified vendor on file: ${vendor.name}`);
      }
      if (vendor.contactEmail && vendor.contactEmail.toLowerCase().trim() === targetIdent) {
        throw new Error(`Cannot block payee identifier '${entry.identifier}' belonging to verified vendor on file: ${vendor.name}`);
      }
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO blocked_payees (id, identifier, reason, source_proposal_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, entry.identifier.trim(), entry.reason, entry.sourceProposalId || null, createdAt);

    this.addAuditLog({
      action: 'PAYEE_BLOCKED',
      actor,
      targetId: id,
      details: {
        identifier: entry.identifier,
        reason: entry.reason,
        sourceProposalId: entry.sourceProposalId
      }
    });

    return {
      id,
      identifier: entry.identifier.trim(),
      reason: entry.reason,
      sourceProposalId: entry.sourceProposalId || null,
      createdAt
    };
  }

  removeBlockedSender(id: string, actor: string): boolean {
    const existing = this.db.prepare('SELECT * FROM blocked_senders WHERE id = ?').get(id) as any;
    if (!existing) return false;

    const res = this.db.prepare('DELETE FROM blocked_senders WHERE id = ?').run(id);
    if (res.changes > 0) {
      this.addAuditLog({
        action: 'SENDER_UNBLOCKED',
        actor,
        targetId: id,
        details: { domain: existing.domain, address: existing.address, reason: existing.reason }
      });
      return true;
    }
    return false;
  }

  removeBlockedPayee(id: string, actor: string): boolean {
    const existing = this.db.prepare('SELECT * FROM blocked_payees WHERE id = ?').get(id) as any;
    if (!existing) return false;

    const res = this.db.prepare('DELETE FROM blocked_payees WHERE id = ?').run(id);
    if (res.changes > 0) {
      this.addAuditLog({
        action: 'PAYEE_UNBLOCKED',
        actor,
        targetId: id,
        details: { identifier: existing.identifier, reason: existing.reason }
      });
      return true;
    }
    return false;
  }

  close(): void {
    this.db.close();
  }
}
