import crypto from 'node:crypto';
import { IRepository } from '../ports/repository.js';
import { IEmailNotifier } from '../ports/notifier.js';
import { VendorConfirmation } from '../../domain/types.js';

export interface SendConfirmationRequest {
  proposalId: string;
  actor: string;
  baseUrl: string;
  ttlHours: number;
}

export interface SendConfirmationResponse {
  confirmation: VendorConfirmation;
  confirmationUrl: string;
  mode: 'smtp' | 'demo_outbox';
  sentTo: string;
}

export class SendConfirmationUseCase {
  constructor(
    private repository: IRepository,
    private notifier: IEmailNotifier
  ) {}

  async execute(request: SendConfirmationRequest): Promise<SendConfirmationResponse> {
    const { proposalId, actor, baseUrl, ttlHours } = request;

    const proposal = this.repository.getProposalById(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    if (proposal.verdict !== 'HOLD' && proposal.verdict !== 'CHECK') {
      throw new Error(`Out-of-band confirmation is only applicable to HOLD or CHECK proposals (current: ${proposal.verdict}).`);
    }

    if (!proposal.vendorId) {
      throw new Error('Proposal is not linked to a verified vendor on file. Confirmation requires an existing vendor record.');
    }

    const vendor = this.repository.getVendorById(proposal.vendorId);
    if (!vendor) {
      throw new Error(`Vendor not found: ${proposal.vendorId}`);
    }

    if (!vendor.contactEmail || !vendor.contactEmail.trim()) {
      throw new Error(`Vendor "${vendor.name}" does not have a verified contact email on file. Out-of-band confirmation cannot be sent.`);
    }

    // Generate 32 bytes crypto random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000).toISOString();
    const confirmationId = `conf_${crypto.randomUUID()}`;

    const confirmation: VendorConfirmation = {
      id: confirmationId,
      proposalId: proposal.id,
      vendorId: vendor.id,
      tokenHash,
      sentTo: vendor.contactEmail,
      status: 'PENDING',
      createdAt: now.toISOString(),
      expiresAt,
      resolvedAt: null
    };

    this.repository.saveConfirmation(confirmation);

    const confirmationUrl = `${baseUrl.replace(/\/$/, '')}/confirm/${rawToken}`;

    const sendResult = await this.notifier.sendConfirmationRequest({
      to: vendor.contactEmail,
      vendorName: vendor.name,
      amount: proposal.amount,
      currency: proposal.currency,
      confirmationUrl
    });

    // Write to audit log
    this.repository.addAuditLog({
      action: 'CONFIRMATION_SENT',
      actor,
      targetId: proposal.id,
      details: {
        confirmationId,
        vendorId: vendor.id,
        sentTo: vendor.contactEmail,
        deliveryMode: sendResult.mode,
        expiresAt
      }
    });

    return {
      confirmation,
      confirmationUrl,
      mode: sendResult.mode,
      sentTo: vendor.contactEmail
    };
  }
}
