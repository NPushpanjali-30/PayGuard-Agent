import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { SESSION_COOKIE_NAME } from '../middleware/auth.js';

export function createAuthRouter(): Router {
  const router = Router();

  const loginSchema = z.object({
    username: z.string().optional(),
    password: z.string().min(1, 'Password is required')
  });

  router.post('/login', (req: Request, res: Response) => {
    const parse = loginSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    const { username, password } = parse.data;
    let matchedUser: string | null = null;

    if (username && username.trim().length > 0) {
      const cleanUsername = username.trim();
      const expectedPassword = config.approversMap.get(cleanUsername);
      if (expectedPassword && expectedPassword === password) {
        matchedUser = cleanUsername;
      }
    } else {
      // Username not provided: fallback to approver if password matches
      if (config.approversMap.has('approver') && config.approversMap.get('approver') === password) {
        matchedUser = 'approver';
      } else {
        for (const [user, pass] of config.approversMap.entries()) {
          if (pass === password) {
            matchedUser = user;
            break;
          }
        }
      }
    }

    if (!matchedUser) {
      res.status(401).json({ error: 'Invalid password. Access denied.' });
      return;
    }

    res.cookie(SESSION_COOKIE_NAME, matchedUser, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      signed: true,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ message: 'Authentication successful', authenticated: true, user: matchedUser });
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
    const authenticated = Boolean(session && typeof session === 'string' && session.trim().length > 0);
    const user = authenticated ? (session === 'authenticated_approver' ? 'approver' : session) : undefined;
    res.json({ authenticated, user });
  });

  return router;
}
