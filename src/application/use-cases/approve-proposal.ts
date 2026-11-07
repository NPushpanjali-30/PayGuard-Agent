import crypto from 'node:crypto';
import { IRepository } from '../ports/repository.js';
import { IPayPalClient } from '../ports/paypal-client.js';
import { validateApprovalPolicy, PolicyConfig, ApprovalActionInput } from '../../domain/policy.js';
import { PaymentProposal, PaymentRecord } from '../../domain/types.js';

export interface ApproveProposalOptions {
  proposalId: string;
  actor: string;
  policyConfig: PolicyConfig;
  actionInput: ApprovalActionInput;
}

export class ApproveProposalUseCase {
  private repository: IRepository;
  private payPalClient: IPayPalClient;

  constructor(repository: IRepository, payPalClient: IPayPalClient) {
    this.repository = repository;
    this.payPalClient = payPalClient;
  }

  async execute(options: ApproveProposalOptions): Promise<PaymentProposal> {
    const { proposalId, actor, policyConfig, actionInput } = options;

    // 1. Run atomic transaction to validate and transition status to PAYING
    // This prevents double-approve race conditions
    const proposal = this.repository.runInTransaction(() => {
      const p = this.repository.getProposalById(proposalId);
      if (!p) {
        throw new Error(`Proposal ${proposalId} not found.`);
      }

      // Validate all policy limits, callback checkbox, and typed amounts
      validateApprovalPolicy(p, actionInput, policyConfig);

      // Transition to PAYING
      p.status = 'PAYING';
      p.callbackConfirmed = Boolean(actionInput.callbackConfirmed);
      p.callbackNote = actionInput.callbackNote || null;
      p.approvalNote = actionInput.approvalNote || null;
      p.updatedAt = new Date().toISOString();

      this.repository.saveProposal(p);

      this.repository.addAuditLog({
        action: 'PROPOSAL_APPROVED',
        actor,
        targetId: p.id,
        details: {
          vendorName: p.vendorName,
          amount: p.amount,
          payee: p.payee,
          verdict: p.verdict,
          callbackNote: p.callbackNote
        }
      });

      return p;
    });

    // 2. Dispatch Payout through PayPal Client
    try {
      const senderItemId = 'item_' + crypto.randomUUID().slice(0, 8);
      const payoutResult = await this.payPalClient.createPayout({
        senderBatchId: proposal.id, // Idempotency key per PayPal spec
        emailSubject: `Payment from small business for ${proposal.vendorName}`,
        items: [
          {
            receiver: proposal.payee,
            amount: proposal.amount,
            currency: proposal.currency,
            note: `Invoice settlement for ${proposal.vendorName}`,
            senderItemId
          }
        ]
      });

      proposal.paypalBatchId = payoutResult.batchId;
      proposal.paypalPayoutItemId = payoutResult.payoutItemId || senderItemId;

      // Poll or check initial status
      let finalStatus: 'PAID' | 'PAYING' | 'FAILED' = 'PAYING';
      if (payoutResult.batchStatus === 'SUCCESS') {
        finalStatus = 'PAID';
      } else if (payoutResult.batchStatus === 'DENIED' || payoutResult.batchStatus === 'CANCELED') {
        finalStatus = 'FAILED';
      } else {
        // Poll once or twice if in mock mode to check transition
        try {
          const polled = await this.payPalClient.getPayoutBatchStatus(payoutResult.batchId);
          if (polled.batchStatus === 'SUCCESS') {
            finalStatus = 'PAID';
          } else if (polled.batchStatus === 'DENIED' || polled.batchStatus === 'CANCELED') {
            finalStatus = 'FAILED';
          }
        } catch {
          // Keep as PAYING if poll failed
        }
      }

      proposal.status = finalStatus;
      proposal.updatedAt = new Date().toISOString();
      this.repository.saveProposal(proposal);

      // If PAID, save payment record
      if (finalStatus === 'PAID') {
        const paymentRecord: PaymentRecord = {
          id: 'pay_' + crypto.randomUUID().slice(0, 10),
          vendorId: proposal.vendorId || 'unregistered',
          payeeEmail: proposal.payee,
          amount: proposal.amount,
          currency: proposal.currency,
          status: 'SUCCESS',
          paypalBatchId: payoutResult.batchId,
          paidAt: new Date().toISOString()
        };
        this.repository.savePaymentRecord(paymentRecord);
      }

      this.repository.addAuditLog({
        action: finalStatus === 'PAID' ? 'PAYMENT_EXECUTED' : 'PAYMENT_SUBMITTED',
        actor,
        targetId: proposal.id,
        details: {
          batchId: payoutResult.batchId,
          batchStatus: payoutResult.batchStatus,
          finalStatus
        }
      });

      return proposal;
    } catch (err: any) {
      proposal.status = 'FAILED';
      proposal.rejectionReason = err.message;
      proposal.updatedAt = new Date().toISOString();
      this.repository.saveProposal(proposal);

      this.repository.addAuditLog({
        action: 'PAYMENT_FAILED',
        actor,
        targetId: proposal.id,
        details: {
          error: err.message
        }
      });

      throw err;
    }
  }
}
