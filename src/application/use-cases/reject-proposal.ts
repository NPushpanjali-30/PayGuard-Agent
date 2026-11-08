import { IRepository } from '../ports/repository.js';
import { PaymentProposal } from '../../domain/types.js';
import { parseRawEmail } from '../../domain/email-parser.js';
import { scanBackstop } from '../../domain/backstop.js';

export interface RejectProposalOptions {
  proposalId: string;
  actor: string;
  reason: string;
  blockSenderDomain?: boolean;
  blockPayeeIdentifiers?: boolean;
}

export class RejectProposalUseCase {
  private repository: IRepository;

  constructor(repository: IRepository) {
    this.repository = repository;
  }

  async execute(options: RejectProposalOptions): Promise<PaymentProposal> {
    const { proposalId, actor, reason, blockSenderDomain, blockPayeeIdentifiers } = options;

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

      if (blockSenderDomain) {
        const parsed = parseRawEmail(proposal.rawEmail);
        const domain = parsed.senderDomain || (parsed.senderAddress.includes('@') ? parsed.senderAddress.split('@')[1] : null);
        if (domain) {
          this.repository.addBlockedSender(
            {
              domain,
              address: parsed.senderAddress || null,
              reason: `Rejected proposal ${proposal.id}: ${reason}`,
              sourceProposalId: proposal.id
            },
            actor
          );
        }
      }

      if (blockPayeeIdentifiers) {
        const payees = new Set<string>();
        if (proposal.requestedPayeeInEmail) {
          payees.add(proposal.requestedPayeeInEmail.trim());
        }
        const backstop = scanBackstop(proposal.rawEmail);
        for (const e of backstop.paypalEmailsFound) payees.add(e.trim());
        for (const i of backstop.ibanFound) payees.add(i.trim());
        for (const a of backstop.accountNumbersFound) payees.add(a.trim());
        for (const f of proposal.flags) {
          const emailMatches = f.evidence.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
          if (emailMatches) {
            for (const m of emailMatches) payees.add(m.trim());
          }
        }

        for (const identifier of payees) {
          if (identifier) {
            this.repository.addBlockedPayee(
              {
                identifier,
                reason: `Rejected proposal ${proposal.id}: ${reason}`,
                sourceProposalId: proposal.id
              },
              actor
            );
          }
        }
      }

      return proposal;
    });
  }
}
