import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { SESSION_COOKIE_NAME } from '../middleware/auth.js';

export function createAuthRouter(): Router {
  const router = Router();

  const loginSchema = z.object({
    password: z.string().min(1, 'Password is required')
  });

  router.post('/login', (req: Request, res: Response) => {
    const parse = loginSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    if (parse.data.password !== config.APP_PASSWORD) {
      res.status(401).json({ error: 'Invalid password. Access denied.' });
      return;
    }

    res.cookie(SESSION_COOKIE_NAME, 'authenticated_approver', {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      signed: true,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ message: 'Authentication successful', authenticated: true });
  });

  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      signed: true
    });
    res.json({ message: 'Logged out successfully', authenticated: false });
  });

  router.get('/me', (req: Request, res: Response) => {
    const session = req.signedCookies[SESSION_COOKIE_NAME];
    const authenticated = session === 'authenticated_approver';
    res.json({ authenticated });
  });

  return router;
}
