import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';

import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { generalLimiter } from './middleware/rate-limit.js';

// Adapters
import { SqliteRepository } from '../adapters/persistence/sqlite-repository.js';
import { MockPayPalClient } from '../adapters/paypal/mock-paypal-client.js';
import { RealPayPalClient } from '../adapters/paypal/real-paypal-client.js';
import { GeminiReader } from '../adapters/ai/gemini-reader.js';
import { GeminiJudge } from '../adapters/ai/gemini-judge.js';
import { KeywordReader } from '../adapters/ai/keyword-reader.js';

// Use Cases
import { CheckEmailUseCase } from '../application/use-cases/check-email.js';
import { ApproveProposalUseCase } from '../application/use-cases/approve-proposal.js';
import { RejectProposalUseCase } from '../application/use-cases/reject-proposal.js';
import { SyncHistoryUseCase } from '../application/use-cases/sync-history.js';
import { UpdateVendorPayeeUseCase } from '../application/use-cases/update-vendor-payee.js';

// Routers
import { createAuthRouter } from './routes/auth.js';
import { createConfigRouter } from './routes/config.js';
import { createSamplesRouter } from './routes/samples.js';
import { createEmailRouter } from './routes/email.js';
import { createProposalsRouter } from './routes/proposals.js';
import { createVendorsRouter } from './routes/vendors.js';
import { createAuditRouter } from './routes/audit.js';
import { createPayPalWebhookRouter } from './routes/paypal-webhook.js';

export function createApp(customRepo?: SqliteRepository): Express {
  const app = express();

  // 1. Security Headers via Helmet
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"]
        }
      }
    })
  );

  // 2. Cookie Parser with signature secret
  app.use(cookieParser(config.SESSION_SECRET));

  // 3. Body parsers with 100 KB limit
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(express.text({ type: 'text/csv', limit: '200kb' }));

  // 4. Instantiate Dependencies
  const repository = customRepo || new SqliteRepository(config.DB_PATH);

  // PayPal Client selection
  const payPalClient =
    config.PAYPAL_MODE === 'sandbox' && config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET
      ? new RealPayPalClient(
          config.PAYPAL_CLIENT_ID,
          config.PAYPAL_CLIENT_SECRET,
          config.PAYPAL_WEBHOOK_ID
        )
      : new MockPayPalClient();

  // AI Reader selection
  const emailReader = config.isAiEnabled
    ? new GeminiReader(config.GEMINI_API_KEY, config.GEMINI_MODEL)
    : new KeywordReader();

  const secondOpinionJudge = config.isAiEnabled
    ? new GeminiJudge(config.GEMINI_API_KEY, config.GEMINI_MODEL)
    : null;

  // Use cases
  const checkEmailUseCase = new CheckEmailUseCase(repository, emailReader, secondOpinionJudge);
  const approveProposalUseCase = new ApproveProposalUseCase(repository, payPalClient);
  const rejectProposalUseCase = new RejectProposalUseCase(repository);
  const syncHistoryUseCase = new SyncHistoryUseCase(repository, payPalClient);
  const updateVendorPayeeUseCase = new UpdateVendorPayeeUseCase(repository);

  // 5. Unauthenticated Public Endpoints
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'PayGuard Agent',
      timestamp: new Date().toISOString(),
      paypalMode: payPalClient.mode,
      aiMode: emailReader.isFallback ? 'fallback' : 'gemini'
    });
  });

  app.use('/api/auth', createAuthRouter());
  app.use('/api/config', createConfigRouter());
  app.use('/api/paypal/webhook', createPayPalWebhookRouter(payPalClient, repository));

  // 6. Protected Endpoints (Require login session & CSRF header)
  app.use('/api/samples', requireAuth, createSamplesRouter());
  app.use('/api/email', requireAuth, createEmailRouter(checkEmailUseCase));
  app.use(
    '/api/proposals',
    requireAuth,
    createProposalsRouter(repository, approveProposalUseCase, rejectProposalUseCase, payPalClient)
  );
  app.use(
    '/api/vendors',
    requireAuth,
    createVendorsRouter(repository, updateVendorPayeeUseCase, syncHistoryUseCase)
  );
  app.use('/api/audit', requireAuth, createAuditRouter(repository));

  // 7. Production Static Frontend Serving
  const distPath = path.resolve(process.cwd(), 'dist/web');
  const webPublicPath = path.resolve(process.cwd(), 'web/dist');
  const staticPath = fs.existsSync(distPath) ? distPath : webPublicPath;

  if (fs.existsSync(staticPath)) {
    app.use(express.static(staticPath));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
        next();
        return;
      }
      res.sendFile(path.join(staticPath, 'index.html'));
    });
  }

  // 8. Global Error Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Unhandled Error]', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error'
    });
  });

  return app;
}
