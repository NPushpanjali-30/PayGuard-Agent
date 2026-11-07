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
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  APPROVAL_LIMIT: z.coerce.number().default(500),
  HARD_LIMIT: z.coerce.number().default(5000),
  DB_PATH: z.string().default('./data/payguard.db'),
  SEED_RECIPIENTS: z.string().optional().default('')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isAiEnabled: Boolean(parsed.data.GEMINI_API_KEY && parsed.data.GEMINI_API_KEY.trim().length > 0)
};
