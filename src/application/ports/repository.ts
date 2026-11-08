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

export interface IRepository {
  // Vendors
  getVendorById(id: string): Vendor | null;
  findVendorByDomainOrName(domain: string, name?: string): Vendor | null;
  getAllVendors(): Vendor[];
  saveVendor(vendor: Vendor): void;
  updateVendorPayee(vendorId: string, newPayee: string, actor: string, reason: string): void;
  updateVendorContactEmail(vendorId: string, contactEmail: string | null, actor: string): void;
  deleteVendor(id: string): boolean;

  // Proposals
  getProposalById(id: string): PaymentProposal | null;
  getAllProposals(): PaymentProposal[];
  saveProposal(proposal: PaymentProposal): void;
  updateProposalStatus(
    id: string,
    status: ProposalStatus,
    extra?: Partial<PaymentProposal>
  ): void;

  // Payments
  getPaymentRecords(vendorId?: string): PaymentRecord[];
  savePaymentRecord(payment: PaymentRecord): void;

  // Audit Logs
  addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void;
  getAuditLogs(limit?: number): AuditLogEntry[];

  // Confirmations
  saveConfirmation(confirmation: VendorConfirmation): void;
  getConfirmationById(id: string): VendorConfirmation | null;
  getConfirmationByTokenHash(tokenHash: string): VendorConfirmation | null;
  getConfirmationByProposalId(proposalId: string): VendorConfirmation | null;
  updateConfirmStatus(id: string, status: ConfirmationStatus, resolvedAt: string | null): void;

  // Intake Idempotency
  getIntakeMessage(messageId: string): { messageId: string; proposalId: string; resultJson: string; createdAt: string } | null;
  saveIntakeMessage(messageId: string, proposalId: string, resultJson: string): void;

  // Blocklist
  getBlockedSenders(): BlockedSender[];
  getBlockedPayees(): BlockedPayee[];
  addBlockedSender(entry: Omit<BlockedSender, 'id' | 'createdAt'>, actor: string): BlockedSender;
  addBlockedPayee(entry: Omit<BlockedPayee, 'id' | 'createdAt'>, actor: string): BlockedPayee;
  removeBlockedSender(id: string, actor: string): boolean;
  removeBlockedPayee(id: string, actor: string): boolean;

  // Atomic transaction support
  runInTransaction<T>(fn: () => T): T;
}
