import rateLimit from 'express-rate-limit';

export const checkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many email check requests. Please wait a few minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

export const approveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many approval requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false
});

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false
});

export const intakeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many email intake requests. Please wait a few minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});
