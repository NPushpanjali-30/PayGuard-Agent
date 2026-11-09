import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { IRepository } from '../../application/ports/repository.js';
import { ApproveProposalUseCase } from '../../application/use-cases/approve-proposal.js';
import { RejectProposalUseCase } from '../../application/use-cases/reject-proposal.js';
import { SendConfirmationUseCase } from '../../application/use-cases/send-confirmation.js';
import { SimulatePayoutUseCase } from '../../application/use-cases/simulate-payout.js';
import { IPayPalClient } from '../../application/ports/paypal-client.js';
import { PayPalApiError } from '../../adapters/paypal/real-paypal-client.js';
import { parseRawEmail } from '../../domain/email-parser.js';
import { approveLimiter } from '../middleware/rate-limit.js';
import { config } from '../config.js';

function tryLinkProposalToVendor(proposal: any, repository: IRepository, actor = 'system'): boolean {
  if (proposal.payee && proposal.vendorId) return false;
  try {
    const parsedEmail = parseRawEmail(proposal.rawEmail);
    const matchedVendor = repository.findVendorByDomainOrName(
      parsedEmail.senderDomain,
      proposal.vendorName !== 'Unknown Vendor' ? proposal.vendorName : undefined
    );
    if (matchedVendor && matchedVendor.paypalEmails.length > 0) {
      proposal.vendorId = matchedVendor.id;
      proposal.vendorName = matchedVendor.name;
      proposal.payee = matchedVendor.paypalEmails[0];
      proposal.updatedAt = new Date().toISOString();
      repository.saveProposal(proposal);
      repository.addAuditLog({
        action: 'PROPOSAL_VENDOR_LINKED',
        actor,
        targetId: proposal.id,
        details: {
          vendorId: matchedVendor.id,
          vendorName: matchedVendor.name,
          payee: proposal.payee
        }
      });
      return true;
    }
  } catch {}
  return false;
}

export function createProposalsRouter(
  repository: IRepository,
  approveUseCase: ApproveProposalUseCase,
  rejectUseCase: RejectProposalUseCase,
  payPalClient: IPayPalClient,
  sendConfirmationUseCase?: SendConfirmationUseCase,
  simulatePayoutUseCase?: SimulatePayoutUseCase,
  mockPayPalClient?: IPayPalClient
): Router {
  const router = Router();

  // 1. List all proposals
  router.get('/', (_req: Request, res: Response) => {
    const proposals = repository.getAllProposals();
    res.json(proposals);
  });

  // 2. Get proposal by ID
  router.get('/:id', (req: Request, res: Response) => {
    let proposal = repository.getProposalById(req.params.id);
    if (!proposal) {
      res.status(404).json({ error: `Proposal ${req.params.id} not found.` });
      return;
    }
    if (!proposal.payee || !proposal.vendorId) {
      tryLinkProposalToVendor(proposal, repository, req.actor || 'system');
    }
    const confirmation = repository.getConfirmationByProposalId(req.params.id);
    const vendor = proposal.vendorId ? repository.getVendorById(proposal.vendorId) : null;
    res.json({
      ...proposal,
      confirmation,
      vendorContactEmail: vendor?.contactEmail || null
    });
  });

  // 2b. Handle GET /:id/approve
  // In the web app, approval must be a state-changing POST request with anti-CSRF protection.
  // When accessed via browser navigation, gracefully redirect to the frontend proposal page.
  // When requested by an API client, return informative 405 Method Not Allowed JSON.
  router.get('/:id/approve', (req: Request, res: Response) => {
    if (req.accepts('html') && !req.xhr && !req.headers['x-payguard-request']) {
      return res.redirect(`/proposals/${req.params.id}`);
    }
    res.status(405).json({
      error: 'Method Not Allowed. Proposal approval must be executed via HTTP POST /api/proposals/:id/approve.',
      proposalId: req.params.id,
      allowedMethods: ['POST']
    });
  });

  // 2c. Handle GET /:id/simulate-payout
  router.get('/:id/simulate-payout', (req: Request, res: Response) => {
    if (req.accepts('html') && !req.xhr && !req.headers['x-payguard-request']) {
      return res.redirect(`/proposals/${req.params.id}`);
    }
    res.status(405).json({
      error: 'Method Not Allowed. Simulated payout must be executed via HTTP POST /api/proposals/:id/simulate-payout.',
      proposalId: req.params.id,
      allowedMethods: ['POST']
    });
  });

  // 3. Approve proposal
  const approveSchema = z.object({
    callbackConfirmed: z.boolean().optional(),
    callbackNote: z.string().optional(),
    typedAmountConfirmation: z.number().nullable().optional(),
    approvalNote: z.string().optional()
  });

  router.post('/:id/approve', approveLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = approveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.format() });
        return;
      }

      const existingProposal = repository.getProposalById(req.params.id);
      if (existingProposal && (!existingProposal.payee || !existingProposal.vendorId)) {
        tryLinkProposalToVendor(existingProposal, repository, req.actor || 'approver');
      }

      const proposal = await approveUseCase.execute({
        proposalId: req.params.id,
        actor: req.actor || 'approver',
        policyConfig: {
          approvalLimit: config.APPROVAL_LIMIT,
          hardLimit: config.HARD_LIMIT,
          dualApprovalThreshold: config.DUAL_APPROVAL_THRESHOLD,
          coolingOffHours: config.NEW_PAYEE_COOLING_OFF_HOURS
        },
        actionInput: {
          ...parsed.data,
          typedAmountConfirmation: parsed.data.typedAmountConfirmation ?? undefined
        }
      });

      res.json(proposal);
    } catch (err: any) {
      if (err instanceof PayPalApiError || err?.isCountryRestricted || err?.errorName === 'PAYOUT_NOT_AVAILABLE') {
        const rawStatus = typeof err.status === 'number' ? err.status : Number(err.status);
        const statusCode = !isNaN(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 403;
        res.status(statusCode).json({
          error: err.message,
          name: err.errorName || 'PAYOUT_NOT_AVAILABLE',
          message: 'PayPal has rejected the payout because the sender account is not eligible to send payouts in this country.',
          debug_id: err.debugId || null,
          status: statusCode,
          countryRestricted: Boolean(err.isCountryRestricted || err.errorName === 'PAYOUT_NOT_AVAILABLE'),
          proposalId: req.params.id
        });
        return;
      }

      res.status(400).json({ error: err.message });
    }
  });

  // 3b. Simulate payout (safe mock fallback for country-restricted accounts or demo)
  router.post('/:id/simulate-payout', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!simulatePayoutUseCase) {
        res.status(500).json({ error: 'Simulate payout use case is not configured.' });
        return;
      }

      const proposal = await simulatePayoutUseCase.execute({
        proposalId: req.params.id,
        actor: req.actor || 'approver'
      });

      res.json(proposal);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 4. Reject proposal
  const rejectSchema = z.object({
    reason: z.string().min(3, 'A descriptive rejection reason is required (min 3 characters)'),
    blockSenderDomain: z.boolean().optional(),
    blockPayeeIdentifiers: z.boolean().optional()
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
        actor: req.actor || 'approver',
        reason: parsed.data.reason,
        blockSenderDomain: parsed.data.blockSenderDomain,
        blockPayeeIdentifiers: parsed.data.blockPayeeIdentifiers
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
          const isMockBatch =
            proposal.paypalBatchId.startsWith('MOCK-') ||
            proposal.paypalBatchId.startsWith('SIMULATED-');
          const client = isMockBatch && mockPayPalClient ? mockPayPalClient : payPalClient;
          const batchStatus = await client.getPayoutBatchStatus(proposal.paypalBatchId);
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
                payeeEmail: proposal.payee || 'unregistered@payee.com',
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

  // 5. Send out-of-band confirmation to vendor contact on file
  router.post('/:id/send-confirmation', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!sendConfirmationUseCase) {
        res.status(500).json({ error: 'Send confirmation use case is not configured.' });
        return;
      }

      const result = await sendConfirmationUseCase.execute({
        proposalId: req.params.id,
        actor: req.actor || 'approver',
        baseUrl: config.APP_BASE_URL,
        ttlHours: config.CONFIRMATION_TTL_HOURS
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to send confirmation' });
    }
  });

  // 6. Demo fast-forward: bypass cooling-off period (only when DEMO_FAST_FORWARD=true)
  router.post('/:id/bypass-cooling-off', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!config.DEMO_FAST_FORWARD) {
        res.status(403).json({
          error:
            'Demo fast-forward is disabled. Set DEMO_FAST_FORWARD=true to enable skipping the cooling-off period.'
        });
        return;
      }

      const proposal = repository.getProposalById(req.params.id);
      if (!proposal) {
        res.status(404).json({ error: `Proposal ${req.params.id} not found.` });
        return;
      }

      proposal.coolingOffBypassed = true;
      proposal.updatedAt = new Date().toISOString();
      repository.saveProposal(proposal);

      repository.addAuditLog({
        action: 'COOLING_OFF_BYPASSED',
        actor: req.actor || 'approver',
        targetId: proposal.id,
        details: {
          coolingOffUntil: proposal.coolingOffUntil,
          reason: 'Demo: fast-forward skip waiting invoked'
        }
      });

      res.json(proposal);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to bypass cooling-off period' });
    }
  });

  return router;
}
