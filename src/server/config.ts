import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_PASSWORD: z.string().default('payguard2026!'),
  SESSION_SECRET: z.string().default('payguard-session-secret-at-least-32-chars-long!'),
  PAYPAL_MODE: z.enum(['mock', 'sandbox']).default('mock'),
  PAYPAL_CLIENT_ID: z.string().optional().default(''),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(''),
  PAYPAL_WEBHOOK_ID: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  APPROVAL_LIMIT: z.coerce.number().default(500),
  HARD_LIMIT: z.coerce.number().default(5000),
  DB_PATH: z.string().default('./data/payguard.db'),
  SEED_RECIPIENTS: z.string().optional().default(''),
  APPROVERS: z.string().optional().default(''),
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  CONFIRMATION_TTL_HOURS: z.coerce.number().default(24),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default(''),
  DUAL_APPROVAL_THRESHOLD: z.coerce.number().default(1000),
  NEW_PAYEE_COOLING_OFF_HOURS: z.coerce.number().default(24),
  DEMO_FAST_FORWARD: z
    .preprocess(v => v === 'true' || v === true, z.boolean())
    .default(false),
  INTAKE_API_KEY: z.string().optional().default('')
});

export function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(env)) {
    if (typeof val === 'string' && val.trim() === '') {
      sanitized[key] = undefined;
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

const parsed = envSchema.safeParse(sanitizeEnv(process.env));
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export function parseApprovers(approversStr: string | undefined, defaultPassword: string): Map<string, string> {
  const map = new Map<string, string>();
  if (approversStr && approversStr.trim().length > 0) {
    const pairs = approversStr.split(',');
    for (const pair of pairs) {
      const idx = pair.indexOf(':');
      if (idx > 0) {
        const user = pair.slice(0, idx).trim();
        const pass = pair.slice(idx + 1).trim();
        if (user && pass) {
          map.set(user, pass);
        }
      }
    }
  }
  if (map.size === 0) {
    map.set('approver', defaultPassword);
  }
  return map;
}

export const config = {
  ...parsed.data,
  get isAiEnabled(): boolean {
    return Boolean(this.GEMINI_API_KEY && this.GEMINI_API_KEY.trim().length > 0);
  },
  approversMap: parseApprovers(parsed.data.APPROVERS, parsed.data.APP_PASSWORD),
  get isSmtpConfigured(): boolean {
    return Boolean(
      this.SMTP_HOST &&
        this.SMTP_HOST.trim().length > 0 &&
        this.SMTP_USER &&
        this.SMTP_USER.trim().length > 0 &&
        this.SMTP_PASS &&
        this.SMTP_PASS.trim().length > 0 &&
        this.SMTP_FROM &&
        this.SMTP_FROM.trim().length > 0
    );
  }
};
