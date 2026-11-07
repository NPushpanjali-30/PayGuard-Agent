import { IRepository } from '../ports/repository.js';
import { PaymentProposal } from '../../domain/types.js';

export interface RejectProposalOptions {
  proposalId: string;
  actor: string;
  reason: string;
}

export class RejectProposalUseCase {
  private repository: IRepository;

  constructor(repository: IRepository) {
    this.repository = repository;
  }

  async execute(options: RejectProposalOptions): Promise<PaymentProposal> {
    const { proposalId, actor, reason } = options;

    return this.repository.runInTransaction(() => {
      const proposal = this.repository.getProposalById(proposalId);
      if (!proposal) {
        throw new Error(`Proposal ${proposalId} not found.`);
      }

      if (proposal.status !== 'PENDING_REVIEW') {
        throw new Error(`Cannot reject proposal with status '${proposal.status}' (must be PENDING_REVIEW).`);
      }

      proposal.status = 'REJECTED';
      proposal.rejectionReason = reason || 'Rejected by approver';
      proposal.updatedAt = new Date().toISOString();

      this.repository.saveProposal(proposal);

      this.repository.addAuditLog({
        action: 'PROPOSAL_REJECTED',
        actor,
        targetId: proposal.id,
        details: {
          vendorName: proposal.vendorName,
          amount: proposal.amount,
          verdict: proposal.verdict,
          reason: proposal.rejectionReason
        }
      });

      return proposal;
    });
  }
}
