import { Router, Request, Response } from 'express';
import { config } from '../config.js';

export function createConfigRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    // SECURITY: NEVER return secret keys or passwords to the browser!
    res.json({
      paypalMode: config.PAYPAL_MODE,
      aiMode: config.isAiEnabled ? 'gemini' : 'fallback',
      model: config.GEMINI_MODEL,
      approvalLimit: config.APPROVAL_LIMIT,
      hardLimit: config.HARD_LIMIT,
      dualApprovalThreshold: config.DUAL_APPROVAL_THRESHOLD,
      demoFastForward: config.DEMO_FAST_FORWARD,
      environment: config.NODE_ENV
    });
  });

  return router;
}
