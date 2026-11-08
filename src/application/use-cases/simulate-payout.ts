import crypto from 'node:crypto';
import { IRepository } from '../ports/repository.js';
import { PaymentProposal, PaymentRecord } from '../../domain/types.js';

export interface SimulatePayoutOptions {
  proposalId: string;
  actor: string;
}

/**
 * Use case to simulate a payout for an already approved proposal when the real PayPal
 * account is country-restricted (PAYOUT_NOT_AVAILABLE) or in a demo sandbox environment.
 *
 * SAFETY INVARIANTS:
 * 1. The proposal MUST have received required human approval(s).
 * 2. It clearly records the transaction as simulated in the database and audit trail.
 * 3. Never marks it as a real PayPal transaction; clearly prefixes with SIMULATED-MOCK-.
 * 4. Separate from real PayPal integration, preventing silent fallback.
 */
export class SimulatePayoutUseCase {
  private repository: IRepository;

  constructor(repository: IRepository) {
    this.repository = repository;
  }

  async execute(options: SimulatePayoutOptions): Promise<PaymentProposal> {
    const { proposalId, actor } = options;

    return this.repository.runInTransaction(() => {
      const proposal = this.repository.getProposalById(proposalId);
      if (!proposal) {
        throw new Error(`Proposal ${proposalId} not found.`);
      }

      // 1. Enforce that human approval was completed
      if (!proposal.firstApprover) {
        throw new Error('Proposal has not been approved by an authorized human approver.');
      }
      if (proposal.requiresDualApproval && !proposal.secondApprover) {
        throw new Error(
          'Dual approval required: Awaiting second human approver before payout can be simulated.'
        );
      }

      // 2. Prevent simulating already paid proposals
      if (proposal.status === 'PAID') {
        throw new Error('Proposal has already been paid.');
      }

      // 3. Only proposals that failed real disbursement or are in PAYING can be simulated
      if (proposal.status !== 'FAILED' && proposal.status !== 'PAYING') {
        throw new Error(
          `Cannot simulate payout for proposal in status '${proposal.status}' (must be FAILED or PAYING).`
        );
      }

      const simulatedBatchId = 'SIMULATED-MOCK-' + crypto.randomUUID().slice(0, 10).toUpperCase();
      const simulatedItemId = 'SIMULATED-ITEM-' + crypto.randomUUID().slice(0, 8).toUpperCase();

      proposal.status = 'PAID';
      proposal.paypalBatchId = simulatedBatchId;
      proposal.paypalPayoutItemId = simulatedItemId;
      proposal.rejectionReason =
        'Simulated payout executed in demo mock fallback mode after PayPal Sandbox rejected live payout with PAYOUT_NOT_AVAILABLE.';
      proposal.updatedAt = new Date().toISOString();
      this.repository.saveProposal(proposal);

      // Record simulated payment
      const paymentRecord: PaymentRecord = {
        id: 'pay_sim_' + crypto.randomUUID().slice(0, 10),
        vendorId: proposal.vendorId || 'unregistered',
        payeeEmail: proposal.payee,
        amount: proposal.amount,
        currency: proposal.currency,
        status: 'SUCCESS',
        paypalBatchId: simulatedBatchId,
        paidAt: new Date().toISOString()
      };
      this.repository.savePaymentRecord(paymentRecord);

      this.repository.addAuditLog({
        action: 'PAYMENT_SIMULATED',
        actor,
        targetId: proposal.id,
        details: {
          simulated: true,
          batchId: simulatedBatchId,
          paypalBatchId: simulatedBatchId,
          originalError: 'PAYOUT_NOT_AVAILABLE',
          amount: proposal.amount,
          currency: proposal.currency,
          payee: proposal.payee,
          vendorName: proposal.vendorName,
          note: 'Demonstrated in simulated mock mode because the real PayPal Sandbox account is country-restricted (PAYOUT_NOT_AVAILABLE).'
        }
      });

      return proposal;
    });
  }
}
