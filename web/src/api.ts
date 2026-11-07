import {
  AppConfig,
  CheckEmailResult,
  PaymentProposal,
  Vendor,
  AuditLogEntry,
  SampleEmailItem
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
    try {
      const errJson = await response.json();
      errMsg = errJson.error || errMsg;
    } catch {
      // fallback
    }
    throw new Error(errMsg);
  }

  return response.json() as Promise<T>;
}

export const api = {
  // Config
  getConfig: () => request<AppConfig>('/config'),

  // Auth
  checkAuth: () => request<{ authenticated: boolean }>('/auth/me'),
  login: (password: string) =>
    request<{ authenticated: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password })
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
  rejectProposal: (id: string, reason: string) =>
    request<PaymentProposal>(`/proposals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    }),

  // Vendors
  getVendors: () => request<Vendor[]>('/vendors'),
  createVendor: (vendor: {
    name: string;
    payeeEmail: string;
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
  getAuditLogs: (limit = 100) => request<AuditLogEntry[]>(`/audit?limit=${limit}`)
};
