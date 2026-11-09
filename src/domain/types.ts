/**
 * Pure Domain Models and Types for PayGuard Agent.
 * No external dependencies or I/O.
 */

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

export type Verdict = 'HOLD' | 'CHECK' | 'CLEAR';

export type RuleId =
  | 'bank_change'
  | 'payee_change'
  | 'payee_change_notice'
  | 'lookalike_domain'
  | 'reply_to_mismatch'
  | 'sender_not_on_file'
  | 'subdomain_sender'
  | 'free_mail_payment'
  | 'unknown_vendor'
  | 'new_payee_identifier'
  | 'amount_anomaly'
  | 'pressure'
  | 'channel_shift'
  | 'gift_cards'
  | 'auth_fail'
  | 'model_judgement'
  | 'no_ai_reader'
  | 'attachment_payee_mismatch'
  | 'attachment_amount_mismatch'
  | 'attachment_new_payee'
  | 'attachment_hidden_instructions'
  | 'attachment_not_read'
  | 'blocklisted_sender'
  | 'blocklisted_payee';

export interface BlockedSender {
  id: string;
  domain?: string | null;
  address?: string | null;
  reason: string;
  sourceProposalId?: string | null;
  createdAt: string;
}

export interface BlockedPayee {
  id: string;
  identifier: string;
  reason: string;
  sourceProposalId?: string | null;
  createdAt: string;
}

export interface Flag {
  id: RuleId;
  severity: Severity;
  title: string;
  evidence: string;
}

export interface EmailHeaders {
  from?: string;
  replyTo?: string;
  to?: string;
  subject?: string;
  authResults?: string;
  date?: string;
  messageId?: string;
  [key: string]: string | undefined;
}

export interface ParsedEmail {
  senderName: string;
  senderAddress: string;
  senderDomain: string;
  replyToAddress?: string;
  replyToDomain?: string;
  subject: string;
  body: string;
  headers: EmailHeaders;
  raw: string;
}

export interface Tactics {
  urgency: boolean;
  secrecy: boolean;
  authority: boolean;
  avoid_phone: boolean;
}

export interface EmailAIAnalysis {
  vendorName: string | null;
  paymentRequested: boolean;
  payeeChangeRequested: boolean;
  payeeChangeMentioned: boolean;
  newPayeeIdentifiers: string[];
  amount: number | null;
  currency: string | null;
  tactics: Tactics;
  channelShift: boolean;
  giftCards: boolean;
  phonesInEmail: string[];
}

export interface SecondOpinion {
  verdict: Verdict;
  reason: string;
}

export interface InvoiceAttachment {
  filename: string;
  mimeType: string;
  contentBase64: string;
  sizeBytes?: number;
}

export interface InvoiceData {
  vendorName: string | null;
  payeeIdentifiers: string[]; // emails, PayPal handles, IBANs, account numbers
  amount: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  dueDate: string | null;
  bankChangeMentioned: boolean;
  hiddenInstructionsDetected: boolean;
  rawExtractedText?: string;
  unreadable?: boolean;
}

export interface AttachmentAnalysisResult {
  attachment: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
  };
  invoiceData: InvoiceData | null;
  error?: string;
}

export interface BackstopSignals {
  ibanFound: string[];
  accountNumbersFound: string[];
  cryptoOrGiftCards: boolean;
  paymentChangePhrases: string[];
  remitToBlock: string | null;
  paypalEmailsFound: string[];
}

export interface Vendor {
  id: string;
  name: string;
  paypalEmails: string[];
  domains: string[];
  phone: string | null;
  contactEmail?: string | null;
  typicalAmount: number;
  paymentCount: number;
  source: 'paypal' | 'csv' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  vendorId: string;
  payeeEmail: string;
  amount: number;
  currency: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  paypalBatchId?: string;
  paidAt: string;
}

export type ProposalStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAYING'
  | 'PAID'
  | 'FAILED'
  | 'BLOCKED';

export interface PaymentProposal {
  id: string;
  vendorId: string | null;
  vendorName: string;
  amount: number;
  currency: string;
  payee: string | null; // STRICTLY from vendor records on file (null if no vendor record on file)
  requestedPayeeInEmail: string | null;
  verdict: Verdict;
  flags: Flag[];
  status: ProposalStatus;
  requiresCallbackCheck: boolean;
  requiresAmountConfirm: boolean;
  isHardBlocked: boolean;
  callbackConfirmed: boolean;
  callbackNote: string | null;
  approvalNote: string | null;
  rejectionReason: string | null;
  paypalBatchId: string | null;
  paypalPayoutItemId: string | null;
  rawEmail: string;
  createdAt: string;
  updatedAt: string;
  requiresDualApproval?: boolean;
  firstApprover?: string | null;
  firstApprovedAt?: string | null;
  secondApprover?: string | null;
  secondApprovedAt?: string | null;
  coolingOffUntil?: string | null;
  coolingOffBypassed?: boolean;
  source?: ProposalSource;
}

export type ProposalSource = 'manual' | 'zapier_intake' | 'mcp';

export interface CallbackRecommendation {
  vendorName: string;
  phoneNumber: string | null;
  hasPhoneOnFile: boolean;
  suggestedQuestions: string[];
  script: string;
}

export interface CheckEmailResult {
  parsedEmail: ParsedEmail;
  aiAnalysis: EmailAIAnalysis;
  secondOpinion: SecondOpinion | null;
  backstop: BackstopSignals;
  matchedVendor: Vendor | null;
  flags: Flag[];
  verdict: Verdict;
  verdictSummary: string;
  callbackRecommendation: CallbackRecommendation;
  proposal: PaymentProposal | null;
  isFallbackReader: boolean;
  attachments?: AttachmentAnalysisResult[];
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  targetId: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

export type ConfirmationStatus = 'PENDING' | 'CONFIRMED' | 'DENIED' | 'EXPIRED';

export interface VendorConfirmation {
  id: string;
  proposalId: string;
  vendorId: string;
  tokenHash: string;
  sentTo: string;
  status: ConfirmationStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
}

