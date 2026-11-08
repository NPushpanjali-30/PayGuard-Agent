import crypto from 'node:crypto';
import { IRepository } from '../ports/repository.js';
import { ConfirmationStatus, VendorConfirmation } from '../../domain/types.js';

export interface GetConfirmationDetailsResponse {
  vendorName: string;
  amount: number;
  currency: string;
  status: ConfirmationStatus;
  isExpired: boolean;
  expiresAt: string;
}

export interface ResolveConfirmationResponse {
  status: 'CONFIRMED' | 'DENIED';
  proposalId: string;
  vendorName: string;
  message: string;
}

export class ResolveConfirmationUseCase {
  constructor(private repository: IRepository) {}

  getDetails(rawToken: string): GetConfirmationDetailsResponse {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const confirmation = this.repository.getConfirmationByTokenHash(tokenHash);

    if (!confirmation) {
      throw new Error('Invalid or expired confirmation link.');
    }

    const proposal = this.repository.getProposalById(confirmation.proposalId);
    if (!proposal) {
      throw new Error('Associated proposal not found.');
    }

    const isExpired = new Date(confirmation.expiresAt).getTime() < Date.now();

    return {
      vendorName: proposal.vendorName,
      amount: proposal.amount,
      currency: proposal.currency,
      status: confirmation.status,
      isExpired,
      expiresAt: confirmation.expiresAt
    };
  }

  async resolve(
    rawToken: string,
    decision: 'CONFIRMED' | 'DENIED',
    ip?: string
  ): Promise<ResolveConfirmationResponse> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const confirmation = this.repository.getConfirmationByTokenHash(tokenHash);

    if (!confirmation) {
      throw new Error('Invalid confirmation token.');
    }

    if (confirmation.status !== 'PENDING') {
      throw new Error(`This confirmation request has already been resolved (${confirmation.status}).`);
    }

    const now = new Date();
    if (new Date(confirmation.expiresAt).getTime() < now.getTime()) {
      this.repository.updateConfirmStatus(confirmation.id, 'EXPIRED', now.toISOString());
      throw new Error('This confirmation token has expired.');
    }

    const proposal = this.repository.getProposalById(confirmation.proposalId);
    if (!proposal) {
      throw new Error('Associated payment proposal not found.');
    }

    // Resolve confirmation
    this.repository.updateConfirmStatus(confirmation.id, decision, now.toISOString());

    // Record in audit log
    this.repository.addAuditLog({
      action: 'CONFIRMATION_RESOLVED',
      actor: `vendor:${confirmation.sentTo}`,
      targetId: proposal.id,
      details: {
        confirmationId: confirmation.id,
        decision,
        ip: ip || 'unknown',
        resolvedAt: now.toISOString()
      }
    });

    // If DENIED, auto-block the proposal immediately!
    if (decision === 'DENIED') {
      this.repository.updateProposalStatus(proposal.id, 'BLOCKED', {
        rejectionReason: 'Vendor explicitly denied authorizing this payment via out-of-band confirmation.'
      });

      this.repository.addAuditLog({
        action: 'PROPOSAL_AUTO_BLOCKED',
        actor: 'system',
        targetId: proposal.id,
        details: {
          confirmationId: confirmation.id,
          reason: 'Vendor denied payment request via out-of-band verification link.'
        }
      });

      return {
        status: 'DENIED',
        proposalId: proposal.id,
        vendorName: proposal.vendorName,
        message: 'Payment denied. The disbursement request has been permanently blocked.'
      };
    }

    return {
      status: 'CONFIRMED',
      proposalId: proposal.id,
      vendorName: proposal.vendorName,
      message: 'Thank you. You have successfully verified this payment request.'
    };
  }
}
