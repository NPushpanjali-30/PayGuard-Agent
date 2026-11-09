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

    // 1. Run atomic transaction to validate and handle single vs dual approval
    // This prevents double-approve race conditions
    const proposal = this.repository.runInTransaction(() => {
      const p = this.repository.getProposalById(proposalId);
      if (!p) {
        throw new Error(`Proposal ${proposalId} not found.`);
      }

      // Check if out-of-band vendor confirmation exists and is confirmed
      const confirmation = this.repository.getConfirmationByProposalId(proposalId);
      const isVendorConfirmed = confirmation?.status === 'CONFIRMED';

      // Validate all policy limits, callback checkbox, and typed amounts
      validateApprovalPolicy(p, { ...actionInput, isVendorConfirmed }, policyConfig);

      // Check historical payments to determine dual-approval requirement and cooling-off
      const paymentRecords = this.repository.getPaymentRecords();
      const hasPaymentRecord = Boolean(
        p.payee &&
        paymentRecords.some(
          rec => rec.payeeEmail.toLowerCase() === p.payee!.toLowerCase() && rec.status === 'SUCCESS'
        )
      );
      const vendor = p.vendorId ? this.repository.getVendorById(p.vendorId) : null;
      const hasVendorHistory = Boolean(
        vendor &&
        vendor.paymentCount > 0 &&
        p.payee &&
        vendor.paypalEmails.some(email => email.toLowerCase() === p.payee!.toLowerCase())
      );
      const hasPriorPayment = hasPaymentRecord || hasVendorHistory;
      const dualThreshold = policyConfig.dualApprovalThreshold ?? 1000;
      const requiresDual = p.requiresDualApproval || p.amount >= dualThreshold || !hasPriorPayment;

      const now = new Date();

      if (requiresDual) {
        p.requiresDualApproval = true;

        if (!p.firstApprover) {
          // Approval 1 of 2
          p.firstApprover = actor;
          p.firstApprovedAt = now.toISOString();

          // New payee triggers cooling-off period starting from first approval
          if (!hasPriorPayment && !p.coolingOffUntil) {
            const coolingHours = policyConfig.coolingOffHours ?? 24;
            p.coolingOffUntil = new Date(now.getTime() + coolingHours * 3600 * 1000).toISOString();
          }

          p.callbackConfirmed = Boolean(actionInput.callbackConfirmed);
          p.callbackNote = actionInput.callbackNote || null;
          p.approvalNote = actionInput.approvalNote || null;
          p.updatedAt = now.toISOString();

          this.repository.saveProposal(p);

          this.repository.addAuditLog({
            action: 'PROPOSAL_FIRST_APPROVAL',
            actor,
            targetId: p.id,
            details: {
              vendorName: p.vendorName,
              amount: p.amount,
              payee: p.payee,
              progress: '1/2',
              coolingOffUntil: p.coolingOffUntil
            }
          });

          // Remains in PENDING_REVIEW awaiting second approver
          return p;
        } else if (!p.secondApprover) {
          // Approval 2 of 2: Must be a different approver!
          if (actor.toLowerCase() === p.firstApprover.toLowerCase()) {
            throw new Error(
              'Dual approval requires two different approvers. The same user cannot approve twice.'
            );
          }

          // Cooling-off verification
          if (p.coolingOffUntil && !p.coolingOffBypassed) {
            if (Date.now() < new Date(p.coolingOffUntil).getTime()) {
              throw new Error(
                `Payment to new payee is in cooling-off period until ${p.coolingOffUntil}. Disbursement cannot be released yet.`
              );
            }
          }

          // Second approval succeeds -> transition to PAYING
          p.secondApprover = actor;
          p.secondApprovedAt = now.toISOString();
          p.status = 'PAYING';
          p.updatedAt = now.toISOString();

          this.repository.saveProposal(p);

          this.repository.addAuditLog({
            action: 'PROPOSAL_APPROVED',
            actor,
            targetId: p.id,
            details: {
              vendorName: p.vendorName,
              amount: p.amount,
              payee: p.payee,
              firstApprover: p.firstApprover,
              secondApprover: actor,
              progress: '2/2'
            }
          });

          return p;
        } else {
          throw new Error('Proposal has already received both approvals.');
        }
      } else {
        // Single approval suffices
        p.firstApprover = actor;
        p.firstApprovedAt = now.toISOString();
        p.status = 'PAYING';
        p.callbackConfirmed = Boolean(actionInput.callbackConfirmed);
        p.callbackNote = actionInput.callbackNote || null;
        p.approvalNote = actionInput.approvalNote || null;
        p.updatedAt = now.toISOString();

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
      }
    });

    // 2. Dispatch Payout through PayPal Client (only when transitioned to PAYING)
    if (proposal.status !== 'PAYING') {
      return proposal;
    }

    try {
      const senderItemId = 'item_' + crypto.randomUUID().slice(0, 8);
      const payoutResult = await this.payPalClient.createPayout({
        senderBatchId: proposal.id, // Idempotency key per PayPal spec
        emailSubject: `Payment from small business for ${proposal.vendorName}`,
        items: [
          {
            receiver: proposal.payee!,
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
          payeeEmail: proposal.payee!,
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
      const isCountryRestricted =
        Boolean(err?.isCountryRestricted) ||
        err?.errorName === 'PAYOUT_NOT_AVAILABLE' ||
        (typeof err?.message === 'string' && err.message.includes('PAYOUT_NOT_AVAILABLE'));

      const httpStatus = typeof err?.status === 'number' ? err.status : 500;
      const errorName = err?.errorName || (isCountryRestricted ? 'PAYOUT_NOT_AVAILABLE' : 'PAYMENT_ERROR');
      const debugId = err?.debugId || null;

      // Preserve existing human approval details, mark payout attempt as FAILED
      proposal.status = 'FAILED';
      proposal.rejectionReason = isCountryRestricted
        ? `PayPal Payout Rejected (403 PAYOUT_NOT_AVAILABLE): The PayPal sender account is registered in a country not permitted to send payouts. Debug ID: ${debugId || 'N/A'}`
        : err.message;
      proposal.updatedAt = new Date().toISOString();
      this.repository.saveProposal(proposal);

      this.repository.addAuditLog({
        action: 'PAYMENT_FAILED',
        actor,
        targetId: proposal.id,
        details: {
          error: err.message,
          errorName,
          httpStatus,
          debugId,
          timestamp: new Date().toISOString(),
          transactionReference: proposal.id,
          countryRestricted: isCountryRestricted,
          accountIneligible: isCountryRestricted,
          senderBatchId: proposal.id,
          amount: proposal.amount,
          payee: proposal.payee
        }
      });

      throw err;
    }
  }
}
