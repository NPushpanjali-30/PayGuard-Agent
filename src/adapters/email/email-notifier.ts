import crypto from 'node:crypto';
import nodemailer, { Transporter } from 'nodemailer';
import { IEmailNotifier, OutboxMessage, SendConfirmationParams } from '../../application/ports/notifier.js';

export interface EmailNotifierConfig {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
}

export class EmailNotifier implements IEmailNotifier {
  private outbox: OutboxMessage[] = [];
  private transporter: Transporter | null = null;
  private isSmtpConfigured: boolean = false;
  private fromAddress: string;

  constructor(config: EmailNotifierConfig = {}) {
    this.fromAddress = config.smtpFrom || 'noreply@payguard-agent.local';

    if (config.smtpHost && config.smtpUser && config.smtpPass && config.smtpFrom) {
      this.isSmtpConfigured = true;
      this.transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort || 587,
        secure: config.smtpPort === 465,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass
        }
      });
    }
  }

  async sendConfirmationRequest(params: SendConfirmationParams): Promise<{
    success: boolean;
    mode: 'smtp' | 'demo_outbox';
    messageId: string;
    confirmationUrl: string;
  }> {
    const messageId = `msg_${crypto.randomUUID()}`;
    const subject = `ACTION REQUIRED: Payment Confirmation Request for ${params.vendorName}`;
    const textBody = [
      `Hello ${params.vendorName},`,
      '',
      `We received an invoice payment request for $${params.amount.toFixed(2)} ${params.currency}${
        params.invoiceNumber ? ` (Invoice #${params.invoiceNumber})` : ''
      }.`,
      '',
      `As part of PayGuard out-of-band fraud protection, please verify if you authorized this disbursement:`,
      `${params.confirmationUrl}`,
      '',
      `This link is single-use and will expire in 24 hours.`,
      '',
      `Thank you,`,
      `PayGuard Agent Team`
    ].join('\n');

    const htmlBody = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #1e3a8a;">PayGuard Out-of-Band Payment Verification</h2>
        <p>Hello <strong>${params.vendorName}</strong>,</p>
        <p>A payment request of <strong>$${params.amount.toFixed(2)} ${params.currency}</strong>${
      params.invoiceNumber ? ` for Invoice <strong>#${params.invoiceNumber}</strong>` : ''
    } is currently pending authorization.</p>
        <p>To prevent fraudulent interception and unauthorized account changes, please click the secure link below to confirm or deny this payment request:</p>
        <div style="margin: 25px 0;">
          <a href="${params.confirmationUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Verify Payment Request
          </a>
        </div>
        <p style="font-size: 0.85rem; color: #6b7280;">If the button does not work, paste this URL into your browser:<br/><a href="${params.confirmationUrl}">${params.confirmationUrl}</a></p>
        <p style="font-size: 0.8rem; color: #9ca3af; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 12px;">This single-use confirmation token expires in 24 hours.</p>
      </div>
    `;

    const outboxMsg: OutboxMessage = {
      id: messageId,
      to: params.to,
      from: this.fromAddress,
      subject,
      text: textBody,
      html: htmlBody,
      confirmationUrl: params.confirmationUrl,
      createdAt: new Date().toISOString(),
      mode: this.isSmtpConfigured ? 'smtp' : 'demo_outbox',
      status: this.isSmtpConfigured ? 'sent' : 'queued_demo'
    };

    // Store in outbox list regardless for history/demo inspection
    this.outbox.unshift(outboxMsg);

    if (this.isSmtpConfigured && this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.fromAddress,
          to: params.to,
          subject,
          text: textBody,
          html: htmlBody
        });
        return {
          success: true,
          mode: 'smtp',
          messageId,
          confirmationUrl: params.confirmationUrl
        };
      } catch (err: any) {
        console.error('[EmailNotifier] SMTP delivery failed, recording to outbox:', err);
        outboxMsg.mode = 'demo_outbox';
        outboxMsg.status = 'queued_demo';
        return {
          success: true,
          mode: 'demo_outbox',
          messageId,
          confirmationUrl: params.confirmationUrl
        };
      }
    }

    return {
      success: true,
      mode: 'demo_outbox',
      messageId,
      confirmationUrl: params.confirmationUrl
    };
  }

  getOutbox(): OutboxMessage[] {
    return [...this.outbox];
  }

  clearOutbox(): void {
    this.outbox = [];
  }
}
