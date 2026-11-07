import {
  Vendor,
  PaymentProposal,
  PaymentRecord,
  AuditLogEntry,
  ProposalStatus
} from '../../domain/types.js';

export interface IRepository {
  // Vendors
  getVendorById(id: string): Vendor | null;
  findVendorByDomainOrName(domain: string, name?: string): Vendor | null;
  getAllVendors(): Vendor[];
  saveVendor(vendor: Vendor): void;
  updateVendorPayee(vendorId: string, newPayee: string, actor: string, reason: string): void;
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

  // Atomic transaction support
  runInTransaction<T>(fn: () => T): T;
}
