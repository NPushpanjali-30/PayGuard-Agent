import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { ResolveConfirmationUseCase } from '../../application/use-cases/resolve-confirmation.js';
import { IEmailNotifier } from '../../application/ports/notifier.js';

export function createConfirmationsRouter(
  resolveUseCase: ResolveConfirmationUseCase,
  notifier: IEmailNotifier
): Router {
  const router = Router();

  // Public rate limiter for confirmation actions: 30 requests per 15 minutes per IP
  const confirmLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many verification attempts. Please try again later.' }
  });

  // Public GET: check token details
  router.get('/token/:token', confirmLimiter, (req: Request, res: Response) => {
    try {
      const details = resolveUseCase.getDetails(req.params.token);
      res.json(details);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Invalid or expired confirmation link' });
    }
  });

  // Public POST: resolve token (CONFIRMED or DENIED)
  const resolveSchema = z.object({
    decision: z.enum(['CONFIRMED', 'DENIED'])
  });

  router.post('/token/:token', confirmLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = resolveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Decision must be either CONFIRMED or DENIED.' });
        return;
      }

      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      const result = await resolveUseCase.resolve(req.params.token, parsed.data.decision, clientIp);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to resolve confirmation request' });
    }
  });

  // Outbox listing (for demo/review in web dashboard)
  router.get('/outbox', (req: Request, res: Response) => {
    const messages = notifier.getOutbox();
    res.json(messages);
  });

  return router;
}
