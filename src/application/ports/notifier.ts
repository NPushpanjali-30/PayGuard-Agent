export interface OutboxMessage {
  id: string;
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  confirmationUrl: string;
  createdAt: string;
  mode: 'smtp' | 'demo_outbox';
  status: 'sent' | 'queued_demo';
}

export interface SendConfirmationParams {
  to: string;
  vendorName: string;
  amount: number;
  currency: string;
  invoiceNumber?: string;
  confirmationUrl: string;
}

export interface IEmailNotifier {
  sendConfirmationRequest(params: SendConfirmationParams): Promise<{
    success: boolean;
    mode: 'smtp' | 'demo_outbox';
    messageId: string;
    confirmationUrl: string;
  }>;
  getOutbox(): OutboxMessage[];
  clearOutbox?(): void;
}
