import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { IRepository } from '../../application/ports/repository.js';

export function createBlocklistRouter(repository: IRepository): Router {
  const router = Router();

  // 1. Get entire blocklist (senders and payees)
  router.get('/', (_req: Request, res: Response) => {
    const senders = repository.getBlockedSenders();
    const payees = repository.getBlockedPayees();
    res.json({ senders, payees });
  });

  // 2. Add blocked sender
  const addSenderSchema = z
    .object({
      domain: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
      reason: z.string().min(2, 'Reason is required')
    })
    .refine(data => !!(data.domain || data.address), {
      message: 'Either domain or address must be provided'
    });

  router.post('/senders', (req: Request, res: Response) => {
    try {
      const parsed = addSenderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const actor = req.actor || 'approver';
      const created = repository.addBlockedSender(
        {
          domain: parsed.data.domain || null,
          address: parsed.data.address || null,
          reason: parsed.data.reason
        },
        actor
      );

      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to block sender' });
    }
  });

  // 3. Remove blocked sender
  router.delete('/senders/:id', (req: Request, res: Response) => {
    const actor = req.actor || 'approver';
    const success = repository.removeBlockedSender(req.params.id, actor);
    if (!success) {
      res.status(404).json({ error: 'Blocked sender entry not found' });
      return;
    }
    res.json({ success: true, id: req.params.id });
  });

  // 4. Add blocked payee
  const addPayeeSchema = z.object({
    identifier: z.string().min(2, 'Payee identifier is required'),
    reason: z.string().min(2, 'Reason is required')
  });

  router.post('/payees', (req: Request, res: Response) => {
    try {
      const parsed = addPayeeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const actor = req.actor || 'approver';
      const created = repository.addBlockedPayee(
        {
          identifier: parsed.data.identifier,
          reason: parsed.data.reason
        },
        actor
      );

      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to block payee' });
    }
  });

  // 5. Remove blocked payee
  router.delete('/payees/:id', (req: Request, res: Response) => {
    const actor = req.actor || 'approver';
    const success = repository.removeBlockedPayee(req.params.id, actor);
    if (!success) {
      res.status(404).json({ error: 'Blocked payee entry not found' });
      return;
    }
    res.json({ success: true, id: req.params.id });
  });

  return router;
}
