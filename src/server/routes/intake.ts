import crypto from 'node:crypto';
import express, { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { CheckEmailUseCase } from '../../application/use-cases/check-email.js';
import { IRepository } from '../../application/ports/repository.js';
import { intakeLimiter } from '../middleware/rate-limit.js';
import { config } from '../config.js';
import { validateAttachmentMagicBytes, MAX_ATTACHMENTS_COUNT } from '../../domain/attachment-validator.js';
import { InvoiceAttachment } from '../../domain/types.js';

export function createIntakeRouter(
  checkEmailUseCase: CheckEmailUseCase,
  repository: IRepository
): Router {
  const router = Router();

  // 8 MB body parser specifically for this intake router
  router.use(express.json({ limit: '8mb' }));
  router.use(express.urlencoded({ extended: true, limit: '8mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 8 * 1024 * 1024, // 8 MB limit per attachment
      files: MAX_ATTACHMENTS_COUNT
    }
  });

  const jsonIntakeSchema = z.object({
    from: z.string().min(1, 'from is required'),
    to: z.string().optional().default(''),
    subject: z.string().optional().default(''),
    body: z.string().min(1, 'body is required'),
    messageId: z.string().optional(),
    attachments: z
      .array(
        z.object({
          filename: z.string(),
          mimeType: z.string(),
          contentBase64: z.string()
        })
      )
      .max(MAX_ATTACHMENTS_COUNT)
      .optional()
  });

  // Authentication & Validation Middleware
  const authenticateIntake = (req: Request, res: Response, next: NextFunction) => {
    // 1. Check if INTAKE_API_KEY is configured
    if (!config.INTAKE_API_KEY || config.INTAKE_API_KEY.trim().length === 0) {
      res.status(403).json({
        error: 'Intake endpoint is disabled: INTAKE_API_KEY is not configured.'
      });
      return;
    }

    // 2. Validate X-Intake-Key header using constant-time comparison
    const clientKey = req.header('x-intake-key') || '';
    const expectedKey = config.INTAKE_API_KEY;

    const clientBuf = Buffer.from(clientKey);
    const expectedBuf = Buffer.from(expectedKey);

    if (
      clientBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(clientBuf, expectedBuf)
    ) {
      res.status(401).json({ error: 'Unauthorized: Invalid or missing X-Intake-Key header.' });
      return;
    }

    next();
  };

  // POST /api/intake/email (accepts both JSON and multipart/form-data)
  router.post(
    '/email',
    intakeLimiter,
    authenticateIntake,
    upload.array('attachments', MAX_ATTACHMENTS_COUNT),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        let from = '';
        let to = '';
        let subject = '';
        let body = '';
        let messageId: string | undefined = undefined;
        const validAttachments: InvoiceAttachment[] = [];

        // Check if files were uploaded via multipart
        const files = req.files as Express.Multer.File[] | undefined;
        if (files && files.length > 0) {
          from = req.body.from || '';
          to = req.body.to || '';
          subject = req.body.subject || '';
          body = req.body.body || '';
          messageId = req.body.messageId || undefined;

          if (!from || !body) {
            res.status(400).json({ error: "Multipart request missing required fields 'from' or 'body'" });
            return;
          }

          for (const file of files) {
            const validation = validateAttachmentMagicBytes(file.buffer);
            if (!validation.valid) {
              res.status(400).json({
                error: `Attachment '${file.originalname}' failed validation: ${validation.error}`
              });
              return;
            }
            validAttachments.push({
              filename: file.originalname,
              mimeType: validation.mimeType || file.mimetype,
              contentBase64: file.buffer.toString('base64'),
              sizeBytes: file.size
            });
          }
        } else {
          // Parse JSON payload
          const parsed = jsonIntakeSchema.safeParse(req.body);
          if (!parsed.success) {
            res.status(400).json({
              error: 'Invalid email intake payload',
              details: parsed.error.format()
            });
            return;
          }

          from = parsed.data.from;
          to = parsed.data.to;
          subject = parsed.data.subject;
          body = parsed.data.body;
          messageId = parsed.data.messageId;

          if (parsed.data.attachments && parsed.data.attachments.length > 0) {
            for (const att of parsed.data.attachments) {
              const buf = Buffer.from(att.contentBase64, 'base64');
              const validation = validateAttachmentMagicBytes(buf);
              if (!validation.valid) {
                res.status(400).json({
                  error: `Attachment '${att.filename}' failed validation: ${validation.error}`
                });
                return;
              }
              validAttachments.push({
                filename: att.filename,
                mimeType: validation.mimeType || att.mimeType,
                contentBase64: att.contentBase64,
                sizeBytes: buf.length
              });
            }
          }
        }

        // Idempotency: Check if messageId already exists
        if (messageId && messageId.trim().length > 0) {
          const cached = repository.getIntakeMessage(messageId.trim());
          if (cached) {
            try {
              const cachedResponse = JSON.parse(cached.resultJson);
              res.json(cachedResponse);
              return;
            } catch {
              // If cached json failed to parse, proceed to recompute
            }
          }
        }

        // Construct standard RFC822 email format from parts
        const rawEmail = `From: ${from}\nTo: ${to}\nSubject: ${subject}\n\n${body}`;

        // Execute CheckEmailUseCase with zapier_intake source
        const result = await checkEmailUseCase.execute({
          rawEmail,
          attachments: validAttachments,
          actor: 'zapier_intake',
          source: 'zapier_intake',
          policyConfig: {
            approvalLimit: config.APPROVAL_LIMIT,
            hardLimit: config.HARD_LIMIT,
            dualApprovalThreshold: config.DUAL_APPROVAL_THRESHOLD,
            coolingOffHours: config.NEW_PAYEE_COOLING_OFF_HOURS
          }
        });

        const proposalId = result.proposal ? result.proposal.id : null;
        const proposalUrl = proposalId ? `${config.APP_BASE_URL}/proposals/${proposalId}` : null;

        const responsePayload = {
          verdict: result.verdict,
          flags: result.flags,
          proposalId,
          url: proposalUrl
        };

        // Cache intake message for idempotency
        if (messageId && messageId.trim().length > 0) {
          repository.saveIntakeMessage(
            messageId.trim(),
            proposalId || '',
            JSON.stringify(responsePayload)
          );
        }

        // Log to audit log
        repository.addAuditLog({
          action: 'EMAIL_INTAKE_RECEIVED',
          actor: 'zapier_intake',
          targetId: proposalId,
          details: {
            messageId: messageId || null,
            from,
            to,
            subject,
            verdict: result.verdict,
            attachmentCount: validAttachments.length
          }
        });

        res.json(responsePayload);
      } catch (err: any) {
        next(err);
      }
    }
  );

  return router;
}
