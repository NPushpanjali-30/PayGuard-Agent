import {
  AppConfig,
  CheckEmailResult,
  PaymentProposal,
  Vendor,
  AuditLogEntry,
  SampleEmailItem,
  VendorConfirmation,
  ConfirmationStatus,
  OutboxMessage,
  BlockedSender,
  BlockedPayee,
  BlocklistResponse
} from './types.js';

const API_BASE = '/api';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-PayGuard-Request', '1');

  if (options.body && !(options.body instanceof FormData) && typeof options.body === 'string') {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include'
  });

  if (!response.ok) {
    let errMsg = `Request failed (${response.status})`;
    let errJson: any = null;
    try {
      errJson = await response.json();
      errMsg = errJson.error || errJson.message || errMsg;
    } catch {
      // fallback
    }
    const err = new Error(errMsg) as any;
    err.status = response.status;
    err.name = errJson?.name;
    err.debug_id = errJson?.debug_id;
    err.countryRestricted = Boolean(errJson?.countryRestricted || errJson?.name === 'PAYOUT_NOT_AVAILABLE');
    err.data = errJson;
    throw err;
  }

  return response.json() as Promise<T>;
}

export const api = {
  // Config
  getConfig: () => request<AppConfig>('/config'),

  // Auth
  checkAuth: () => request<{ authenticated: boolean; user?: string }>('/auth/me'),
  login: (password: string, username?: string) =>
    request<{ authenticated: boolean; user?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password, username })
    }),
  logout: () =>
    request<{ message: string }>('/auth/logout', {
      method: 'POST'
    }),

  // Samples
  getSamples: () => request<SampleEmailItem[]>('/samples'),

  // Email Check
  checkEmail: (rawEmail: string) =>
    request<CheckEmailResult>('/email/check', {
      method: 'POST',
      body: JSON.stringify({ rawEmail })
    }),
  checkEmailWithAttachments: (formData: FormData) =>
    request<CheckEmailResult>('/email/check-with-attachments', {
      method: 'POST',
      body: formData
    }),

  // Proposals
  getProposals: () => request<PaymentProposal[]>('/proposals'),
  getProposal: (id: string) => request<PaymentProposal>(`/proposals/${id}`),
  pollProposal: (id: string) => request<PaymentProposal>(`/proposals/${id}/poll`),
  approveProposal: (
    id: string,
    data: {
      callbackConfirmed?: boolean;
      callbackNote?: string;
      typedAmountConfirmation?: number;
      approvalNote?: string;
    }
  ) =>
    request<PaymentProposal>(`/proposals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  simulatePayout: (id: string) =>
    request<PaymentProposal>(`/proposals/${id}/simulate-payout`, {
      method: 'POST'
    }),
  rejectProposal: (
    id: string,
    reason: string,
    options?: { blockSenderDomain?: boolean; blockPayeeIdentifiers?: boolean }
  ) =>
    request<PaymentProposal>(`/proposals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason, ...options })
    }),
  sendConfirmation: (proposalId: string) =>
    request<{
      confirmation: VendorConfirmation;
      confirmationUrl: string;
      mode: 'smtp' | 'demo_outbox';
      sentTo: string;
    }>(`/proposals/${proposalId}/send-confirmation`, {
      method: 'POST'
    }),
  bypassCoolingOff: (proposalId: string) =>
    request<PaymentProposal>(`/proposals/${proposalId}/bypass-cooling-off`, {
      method: 'POST'
    }),

  // Public Confirmation endpoints
  getConfirmationDetails: (token: string) =>
    request<{
      vendorName: string;
      amount: number;
      currency: string;
      status: ConfirmationStatus;
      isExpired: boolean;
      expiresAt: string;
    }>(`/confirm/token/${token}`),
  resolveConfirmation: (token: string, decision: 'CONFIRMED' | 'DENIED') =>
    request<{
      status: 'CONFIRMED' | 'DENIED';
      proposalId: string;
      vendorName: string;
      message: string;
    }>(`/confirm/token/${token}`, {
      method: 'POST',
      body: JSON.stringify({ decision })
    }),

  // Outbox
  getOutbox: () => request<OutboxMessage[]>('/outbox'),

  // Vendors
  getVendors: () => request<Vendor[]>('/vendors'),
  createVendor: (vendor: {
    name: string;
    payeeEmail: string;
    contactEmail?: string | null;
    domains?: string[];
    phone?: string | null;
    typicalAmount?: number;
  }) =>
    request<Vendor>('/vendors', {
      method: 'POST',
      body: JSON.stringify(vendor)
    }),
  updateVendorPayee: (vendorId: string, newPayee: string, reason: string) =>
    request<Vendor>(`/vendors/${vendorId}/payee`, {
      method: 'PUT',
      body: JSON.stringify({ newPayee, reason })
    }),
  updateVendorContactEmail: (vendorId: string, contactEmail: string | null) =>
    request<Vendor>(`/vendors/${vendorId}/contact-email`, {
      method: 'PUT',
      body: JSON.stringify({ contactEmail })
    }),
  importCsvVendors: (csvContent: string) =>
    request<{ importedCount: number; vendors: Vendor[]; errors: string[] }>('/vendors/import-csv', {
      method: 'POST',
      body: JSON.stringify({ csvContent })
    }),
  syncPayPalHistory: () =>
    request<{
      syncedTransactionsCount: number;
      localPaymentsCount: number;
      updatedVendorsCount: number;
      message: string;
    }>('/vendors/sync-paypal', {
      method: 'POST'
    }),

  // Audit Logs
  getAuditLogs: (limit = 100) => request<AuditLogEntry[]>(`/audit?limit=${limit}`),

  // Blocklist
  getBlocklist: () => request<BlocklistResponse>('/blocklist'),
  addBlockedSender: (data: { domain?: string | null; address?: string | null; reason: string }) =>
    request<BlockedSender>('/blocklist/senders', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  removeBlockedSender: (id: string) =>
    request<{ success: boolean; id: string }>(`/blocklist/senders/${id}`, {
      method: 'DELETE'
    }),
  addBlockedPayee: (data: { identifier: string; reason: string }) =>
    request<BlockedPayee>('/blocklist/payees', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  removeBlockedPayee: (id: string) =>
    request<{ success: boolean; id: string }>(`/blocklist/payees/${id}`, {
      method: 'DELETE'
    })
};
