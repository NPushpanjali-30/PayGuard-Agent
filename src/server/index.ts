import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(`🛡️ PayGuard Agent running on http://localhost:${config.PORT}`);
  logger.info(`💳 PayPal Mode: ${config.PAYPAL_MODE.toUpperCase()}`);
  logger.info(`🤖 AI Reader: ${config.isAiEnabled ? `Gemini (${config.GEMINI_MODEL})` : 'Cautious Fallback Reader'}`);
  logger.info(`🔒 Security: Approval Limit: $${config.APPROVAL_LIMIT}, Hard Limit: $${config.HARD_LIMIT}`);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, gracefully shutting down server...');
  server.close(() => {
    logger.info('PayGuard Agent server closed.');
    process.exit(0);
  });
});
