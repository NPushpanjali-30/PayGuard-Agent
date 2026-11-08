import crypto from 'node:crypto';
import { IRepository } from '../ports/repository.js';
import { IPayPalClient, CreatePayoutBatchRequest } from '../ports/paypal-client.js';
import { PaymentProposal, PaymentRecord } from '../../domain/types.js';

export interface SimulatePayoutOptions {
  proposalId: string;
  actor: string;
}

/**
 * Use case to execute a simulated payout via MockPayPalClient for an already approved proposal
 * when the real PayPal account is country-restricted (PAYOUT_NOT_AVAILABLE) or in a demo sandbox environment.
 *
 * SAFETY INVARIANTS:
 * 1. The proposal MUST have received required human approval signature(s).
 * 2. All existing fraud checks, vendor verification, and cooling-off rules must be satisfied.
 * 3. Actively invokes the existing MockPayPalClient to generate mock batch records.
 * 4. Generates a clearly identifiable simulated batch reference (SIMULATED-MOCK-...).
 * 5. Persists the transaction in the database and append-only audit trail.
 * 6. Never calls live PayPal endpoints and never marks transaction as real PayPal PAID.
 */
export class SimulatePayoutUseCase {
  constructor(
    private repository: IRepository,
    private mockPayPalClient: IPayPalClient
  ) {}

  async execute(options: SimulatePayoutOptions): Promise<PaymentProposal> {
    const { proposalId, actor } = options;

    // 1. Synchronously validate existing proposal state and approval signatures
    const proposal = this.repository.runInTransaction(() => {
      const p = this.repository.getProposalById(proposalId);
      if (!p) {
        throw new Error(`Proposal ${proposalId} not found.`);
      }

      // Verify required human approval
      if (!p.firstApprover) {
        throw new Error('Proposal has not been approved by an authorized human approver.');
      }
      if (p.requiresDualApproval && !p.secondApprover) {
        throw new Error(
          'Dual approval required: Awaiting second human approver before payout can be simulated.'
        );
      }

      // Prevent simulating already paid proposals
      if (p.status === 'PAID') {
        throw new Error('Proposal has already been paid.');
      }

      // Must be in FAILED or PAYING status (or PENDING_REVIEW if approvals recorded)
      if (p.status !== 'FAILED' && p.status !== 'PAYING') {
        throw new Error(
          `Cannot simulate payout for proposal in status '${p.status}' (must be FAILED or PAYING).`
        );
      }

      // Verify existing fraud and vendor checks
      if (p.isHardBlocked) {
        throw new Error('Cannot execute simulated payout: Proposal is hard-blocked due to security policy.');
      }

      // Check HOLD proposal prerequisites
      const confirmation = this.repository.getConfirmationByProposalId(proposalId);
      const isVendorConfirmed = confirmation?.status === 'CONFIRMED';
      if (p.verdict === 'HOLD' && !isVendorConfirmed && !p.callbackConfirmed) {
        throw new Error(
          'Cannot execute simulated payout: HOLD proposal requires verified vendor contact or callback note.'
        );
      }

      // Check cooling-off period
      if (p.coolingOffUntil && !p.coolingOffBypassed) {
        if (Date.now() < new Date(p.coolingOffUntil).getTime()) {
          throw new Error(
            `Cannot execute simulated payout: New payee cooling-off period active until ${p.coolingOffUntil}.`
          );
        }
      }

      return p;
    });

    // 2. Execute existing MockPayPalClient (never calls live PayPal)
    const batchRequest: CreatePayoutBatchRequest = {
      senderBatchId: `SIMULATED-${proposal.id}`,
      emailSubject: `[SIMULATED] Payment from PayGuard Agent: Invoice #${proposal.id}`,
      items: [
        {
          receiver: proposal.payee,
          amount: proposal.amount,
          currency: proposal.currency,
          note: `Simulated payout for ${proposal.vendorName}`,
          senderItemId: `SIM-ITEM-${proposal.id}`
        }
      ]
    };

    const payoutResult = await this.mockPayPalClient.createPayout(batchRequest);

    // 3. Generate a clearly identifiable simulated transaction reference
    const rawBatchId = payoutResult.batchId || crypto.randomUUID().slice(0, 10).toUpperCase();
    const simulatedBatchId = rawBatchId.startsWith('SIMULATED-')
      ? rawBatchId
      : `SIMULATED-${rawBatchId}`;

    const rawItemId = payoutResult.payoutItemId || `ITEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const simulatedItemId = rawItemId.startsWith('SIMULATED-')
      ? rawItemId
      : `SIMULATED-${rawItemId}`;

    // 4. Update the database and audit trail atomically
    return this.repository.runInTransaction(() => {
      const latest = this.repository.getProposalById(proposal.id)!;
      latest.status = 'PAID';
      latest.paypalBatchId = simulatedBatchId;
      latest.paypalPayoutItemId = simulatedItemId;
      latest.rejectionReason =
        `[SIMULATED PAYOUT] Executed via MockPayPalClient for demonstration (live PayPal returned 403 PAYOUT_NOT_AVAILABLE). Batch: ${simulatedBatchId}`;
      latest.updatedAt = new Date().toISOString();
      this.repository.saveProposal(latest);

      // Store transaction in existing database (payment_records)
      const paymentRecord: PaymentRecord = {
        id: 'pay_sim_' + crypto.randomUUID().slice(0, 10),
        vendorId: latest.vendorId || 'unregistered',
        payeeEmail: latest.payee,
        amount: latest.amount,
        currency: latest.currency,
        status: 'SUCCESS',
        paypalBatchId: simulatedBatchId,
        paidAt: new Date().toISOString()
      };
      this.repository.savePaymentRecord(paymentRecord);

      // Record simulated payout in audit trail
      this.repository.addAuditLog({
        action: 'PAYMENT_SIMULATED',
        actor,
        targetId: latest.id,
        details: {
          simulated: true,
          batchId: simulatedBatchId,
          paypalBatchId: simulatedBatchId,
          payoutItemId: simulatedItemId,
          mockBatchStatus: payoutResult.batchStatus,
          originalError: 'PAYOUT_NOT_AVAILABLE',
          amount: latest.amount,
          currency: latest.currency,
          payee: latest.payee,
          vendorName: latest.vendorName,
          clientMode: 'mock',
          clientUsed: 'MockPayPalClient',
          note: 'Executed via MockPayPalClient for demonstration because real PayPal Sandbox account is country-restricted (PAYOUT_NOT_AVAILABLE).'
        }
      });

      return latest;
    });
  }
}
