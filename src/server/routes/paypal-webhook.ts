import { Router, Request, Response } from 'express';
import { IPayPalClient } from '../../application/ports/paypal-client.js';
import { IRepository } from '../../application/ports/repository.js';
import { config } from '../config.js';

export function createPayPalWebhookRouter(
  payPalClient: IPayPalClient,
  repository: IRepository
): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    try {
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

      // Verify signature if PAYPAL_WEBHOOK_ID is set
      if (config.PAYPAL_WEBHOOK_ID) {
        const headers: Record<string, string> = {};
        for (const [key, val] of Object.entries(req.headers)) {
          if (typeof val === 'string') headers[key.toLowerCase()] = val;
        }

        const isValid = await payPalClient.verifyWebhookSignature(headers, rawBody);
        if (!isValid) {
          res.status(400).json({ error: 'Invalid PayPal webhook signature' });
          return;
        }
      }

      const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const eventType = event.event_type;
      const resource = event.resource || {};

      repository.addAuditLog({
        action: 'PAYPAL_WEBHOOK_RECEIVED',
        actor: 'paypal_webhook',
        targetId: resource.batch_header?.payout_batch_id || resource.payout_batch_id || null,
        details: { eventType, summary: event.summary }
      });

      // Update matching proposal status
      const batchId = resource.batch_header?.payout_batch_id || resource.payout_batch_id;
      if (batchId) {
        const proposals = repository.getAllProposals();
        const matchingProposal = proposals.find(p => p.paypalBatchId === batchId);

        if (matchingProposal) {
          if (eventType === 'PAYMENT.PAYOUTSBATCH.SUCCESS' || eventType === 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED') {
            repository.updateProposalStatus(matchingProposal.id, 'PAID');
          } else if (eventType === 'PAYMENT.PAYOUTSBATCH.DENIED') {
            repository.updateProposalStatus(matchingProposal.id, 'FAILED', {
              rejectionReason: 'PayPal webhook reported payout denied'
            });
          }
        }
      }

      res.status(200).json({ status: 'received' });
    } catch (err: any) {
      console.warn(`[PayPalWebhook] Error processing webhook: ${err.message}`);
      res.status(200).json({ status: 'error_logged' });
    }
  });

  return router;
}
