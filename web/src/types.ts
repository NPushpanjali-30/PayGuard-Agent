export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type Verdict = 'HOLD' | 'CHECK' | 'CLEAR';
export type ProposalStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAYING'
  | 'PAID'
  | 'FAILED'
  | 'BLOCKED';

export interface Flag {
  id: string;
  severity: Severity;
  title: string;
  evidence: string;
}

export interface PaymentProposal {
  id: string;
  vendorId: string | null;
  vendorName: string;
  amount: number;
  currency: string;
  payee: string;
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
}

export interface Vendor {
  id: string;
  name: string;
  paypalEmails: string[];
  domains: string[];
  phone: string | null;
  typicalAmount: number;
  paymentCount: number;
  source: 'paypal' | 'csv' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export interface CallbackRecommendation {
  vendorName: string;
  phoneNumber: string | null;
  hasPhoneOnFile: boolean;
  suggestedQuestions: string[];
  script: string;
}

export interface CheckEmailResult {
  parsedEmail: {
    senderName: string;
    senderAddress: string;
    senderDomain: string;
    replyToAddress?: string;
    replyToDomain?: string;
    subject: string;
    body: string;
  };
  aiAnalysis: {
    vendorName: string | null;
    paymentRequested: boolean;
    payeeChangeRequested: boolean;
    payeeChangeMentioned: boolean;
    newPayeeIdentifiers: string[];
    amount: number | null;
    currency: string | null;
    tactics: {
      urgency: boolean;
      secrecy: boolean;
      authority: boolean;
      avoid_phone: boolean;
    };
    channelShift: boolean;
    giftCards: boolean;
    phonesInEmail: string[];
  };
  secondOpinion: {
    verdict: Verdict;
    reason: string;
  } | null;
  matchedVendor: Vendor | null;
  flags: Flag[];
  verdict: Verdict;
  verdictSummary: string;
  callbackRecommendation: CallbackRecommendation;
  proposal: PaymentProposal | null;
  isFallbackReader: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  targetId: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface AppConfig {
  paypalMode: 'mock' | 'sandbox';
  aiMode: 'gemini' | 'fallback';
  model: string;
  approvalLimit: number;
  hardLimit: number;
  environment: string;
}

export interface SampleEmailItem {
  id: string;
  title: string;
  category: 'fraud' | 'honest';
  label: string;
  rawEmail: string;
}
