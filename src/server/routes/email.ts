import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CheckEmailUseCase } from '../../application/use-cases/check-email.js';
import { checkLimiter } from '../middleware/rate-limit.js';
import { config } from '../config.js';

export function createEmailRouter(checkEmailUseCase: CheckEmailUseCase): Router {
  const router = Router();

  const checkEmailSchema = z.object({
    rawEmail: z
      .string({ required_error: 'rawEmail is required' })
      .min(5, 'Email content is too short')
      .max(100 * 1024, 'Email exceeds the 100 KB maximum size limit')
  });

  router.post('/check', checkLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = checkEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.format()
        });
        return;
      }

      const result = await checkEmailUseCase.execute({
        rawEmail: parsed.data.rawEmail,
        actor: 'approver',
        policyConfig: {
          approvalLimit: config.APPROVAL_LIMIT,
          hardLimit: config.HARD_LIMIT
        }
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
