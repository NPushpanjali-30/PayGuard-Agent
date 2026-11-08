import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

declare global {
  namespace Express {
    interface Request {
      actor?: string;
    }
  }
}

export const SESSION_COOKIE_NAME = 'payguard_session';

/**
 * Checks signed session cookie for authenticated user and extracts approver identity.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = req.signedCookies[SESSION_COOKIE_NAME];
  if (!session || typeof session !== 'string' || session.trim().length === 0) {
    res.status(401).json({ error: 'Authentication required. Please log in.' });
    return;
  }

  const actor = session === 'authenticated_approver' ? 'approver' : session;
  req.actor = actor;

  // Enforce CSRF defense on state-changing requests (POST, PUT, DELETE, PATCH)
  const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (mutatingMethods.includes(req.method)) {
    const customHeader = req.headers['x-payguard-request'] || req.headers['x-requested-with'];
    if (!customHeader) {
      res.status(403).json({
        error: 'Missing anti-CSRF request header (X-PayGuard-Request: 1 required on mutating actions).'
      });
      return;
    }
  }

  next();
}
