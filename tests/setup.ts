import { beforeEach, afterEach } from 'vitest';

// 1. Top-level environment initialization.
// Executed before any test files or application code load.
// This ensures that dotenv.config() in src/server/config.ts will not override these values
// even if a developer has APPROVERS, INTAKE_API_KEY, or GEMINI_API_KEY populated in their local .env.
process.env.NODE_ENV = 'test';
process.env.PAYPAL_MODE = 'mock';
process.env.APP_PASSWORD = 'payguard2026!';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars-long!';
process.env.APPROVERS = '';
process.env.INTAKE_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
process.env.PAYPAL_WEBHOOK_ID = '';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.SMTP_FROM = '';

let configModule: typeof import('../src/server/config.js') | null = null;

async function resetHermeticState() {
  // Ensure process.env keys remain hermetic
  process.env.NODE_ENV = 'test';
  process.env.PAYPAL_MODE = 'mock';
  process.env.APP_PASSWORD = 'payguard2026!';
  process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars-long!';
  process.env.APPROVERS = '';
  process.env.INTAKE_API_KEY = '';
  process.env.GEMINI_API_KEY = '';
  process.env.PAYPAL_CLIENT_ID = '';
  process.env.PAYPAL_CLIENT_SECRET = '';
  process.env.PAYPAL_WEBHOOK_ID = '';
  process.env.SMTP_HOST = '';
  process.env.SMTP_USER = '';
  process.env.SMTP_PASS = '';
  process.env.SMTP_FROM = '';

  if (!configModule) {
    configModule = await import('../src/server/config.js');
  }

  const { config } = configModule;

  // Reset config object properties
  config.NODE_ENV = 'test';
  config.PAYPAL_MODE = 'mock';
  config.APP_PASSWORD = 'payguard2026!';
  config.SESSION_SECRET = 'test-session-secret-at-least-32-chars-long!';
  config.APPROVERS = '';
  config.INTAKE_API_KEY = '';
  config.GEMINI_API_KEY = '';
  config.PAYPAL_CLIENT_ID = '';
  config.PAYPAL_CLIENT_SECRET = '';
  config.PAYPAL_WEBHOOK_ID = '';
  config.SMTP_HOST = '';
  config.SMTP_USER = '';
  config.SMTP_PASS = '';
  config.SMTP_FROM = '';
  config.DEMO_FAST_FORWARD = false;

  // Reset approver identities to single-approver fallback
  config.approversMap.clear();
  config.approversMap.set('approver', config.APP_PASSWORD);
}

// Reset hermetic state before and after each test
beforeEach(async () => {
  await resetHermeticState();
});

afterEach(async () => {
  await resetHermeticState();
});
