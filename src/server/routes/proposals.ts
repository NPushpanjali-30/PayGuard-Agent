import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { IRepository } from '../../application/ports/repository.js';
import { ApproveProposalUseCase } from '../../application/use-cases/approve-proposal.js';
import { RejectProposalUseCase } from '../../application/use-cases/reject-proposal.js';
import { IPayPalClient } from '../../application/ports/paypal-client.js';
import { approveLimiter } from '../middleware/rate-limit.js';
import { config } from '../config.js';

export function createProposalsRouter(
  repository: IRepository,
  approveUseCase: ApproveProposalUseCase,
  rejectUseCase: RejectProposalUseCase,
  payPalClient: IPayPalClient
): Router {
  const router = Router();

  // 1. List all proposals
  router.get('/', (_req: Request, res: Response) => {
    const proposals = repository.getAllProposals();
    res.json(proposals);
  });

  // 2. Get proposal by ID
  router.get('/:id', (req: Request, res: Response) => {
    const proposal = repository.getProposalById(req.params.id);
    if (!proposal) {
      res.status(404).json({ error: `Proposal ${req.params.id} not found.` });
      return;
    }
    res.json(proposal);
  });

  // 3. Approve proposal
  const approveSchema = z.object({
    callbackConfirmed: z.boolean().optional(),
    callbackNote: z.string().optional(),
    typedAmountConfirmation: z.number().optional(),
    approvalNote: z.string().optional()
  });

  router.post('/:id/approve', approveLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = approveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.format() });
        return;
      }

      const proposal = await approveUseCase.execute({
        proposalId: req.params.id,
        actor: 'approver',
        policyConfig: {
          approvalLimit: config.APPROVAL_LIMIT,
          hardLimit: config.HARD_LIMIT
        },
        actionInput: parsed.data
      });

      res.json(proposal);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 4. Reject proposal
  const rejectSchema = z.object({
    reason: z.string().min(3, 'A descriptive rejection reason is required (min 3 characters)')
  });

  router.post('/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = rejectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.format() });
        return;
      }

      const proposal = await rejectUseCase.execute({
        proposalId: req.params.id,
        actor: 'approver',
        reason: parsed.data.reason
      });

      res.json(proposal);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 5. Poll PayPal batch status for active proposal
  router.get('/:id/poll', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const proposal = repository.getProposalById(req.params.id);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }

      if (proposal.status === 'PAYING' && proposal.paypalBatchId) {
        try {
          const batchStatus = await payPalClient.getPayoutBatchStatus(proposal.paypalBatchId);
          if (batchStatus.batchStatus === 'SUCCESS') {
            proposal.status = 'PAID';
            proposal.updatedAt = new Date().toISOString();
            repository.saveProposal(proposal);

            // Record in payments table if not already recorded
            const existing = repository.getPaymentRecords().find(p => p.paypalBatchId === batchStatus.batchId);
            if (!existing) {
              repository.savePaymentRecord({
                id: 'pay_' + req.params.id,
                vendorId: proposal.vendorId || 'unregistered',
                payeeEmail: proposal.payee,
                amount: proposal.amount,
                currency: proposal.currency,
                status: 'SUCCESS',
                paypalBatchId: batchStatus.batchId,
                paidAt: new Date().toISOString()
              });
            }
          } else if (batchStatus.batchStatus === 'DENIED' || batchStatus.batchStatus === 'CANCELED') {
            proposal.status = 'FAILED';
            proposal.updatedAt = new Date().toISOString();
            repository.saveProposal(proposal);
          }
        } catch (pollErr: any) {
          console.warn(`[PollStatus] Payout status poll failed: ${pollErr.message}`);
        }
      }

      res.json(proposal);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
