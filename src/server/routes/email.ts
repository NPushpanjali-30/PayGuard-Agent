import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CheckEmailUseCase } from '../../application/use-cases/check-email.js';
import { checkLimiter } from '../middleware/rate-limit.js';
import { config } from '../config.js';

import multer from 'multer';
import { validateAttachmentMagicBytes, MAX_ATTACHMENTS_COUNT, MAX_ATTACHMENT_SIZE_BYTES } from '../../domain/attachment-validator.js';
import { InvoiceAttachment } from '../../domain/types.js';

export function createEmailRouter(checkEmailUseCase: CheckEmailUseCase): Router {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_ATTACHMENT_SIZE_BYTES,
      files: MAX_ATTACHMENTS_COUNT
    }
  });

  const checkEmailSchema = z.object({
    rawEmail: z
      .string({ required_error: 'rawEmail is required' })
      .min(5, 'Email content is too short')
      .max(100 * 1024, 'Email exceeds the 100 KB maximum size limit'),
    attachments: z
      .array(
        z.object({
          filename: z.string(),
          mimeType: z.string(),
          contentBase64: z.string(),
          sizeBytes: z.number().optional()
        })
      )
      .max(MAX_ATTACHMENTS_COUNT)
      .optional()
  });

  // 1. JSON check endpoint
  router.post('/check', checkLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = checkEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.format()
        });
        return;
      }

      // If base64 attachments were passed via JSON, validate their magic bytes
      const validatedAttachments: InvoiceAttachment[] = [];
      if (parsed.data.attachments) {
        for (const att of parsed.data.attachments) {
          const buf = Buffer.from(att.contentBase64, 'base64');
          const validation = validateAttachmentMagicBytes(buf);
          if (!validation.valid) {
            res.status(400).json({
              error: `Attachment '${att.filename}' failed validation: ${validation.error}`
            });
            return;
          }
          validatedAttachments.push({
            filename: att.filename,
            mimeType: validation.mimeType || att.mimeType,
            contentBase64: att.contentBase64,
            sizeBytes: buf.length
          });
        }
      }

      const result = await checkEmailUseCase.execute({
        rawEmail: parsed.data.rawEmail,
        attachments: validatedAttachments,
        actor: req.actor || 'approver',
        policyConfig: {
          approvalLimit: config.APPROVAL_LIMIT,
          hardLimit: config.HARD_LIMIT
        }
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // 2. Dedicated multipart route with higher body limit (memory storage only)
  router.post(
    '/check-with-attachments',
    checkLimiter,
    upload.array('attachments', MAX_ATTACHMENTS_COUNT),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawEmail = req.body.rawEmail;
        if (!rawEmail || typeof rawEmail !== 'string' || rawEmail.trim().length < 5) {
          res.status(400).json({ error: 'rawEmail is required and must be at least 5 characters' });
          return;
        }

        const files = (req.files as Express.Multer.File[]) || [];
        const validatedAttachments: InvoiceAttachment[] = [];

        for (const file of files) {
          const validation = validateAttachmentMagicBytes(file.buffer);
          if (!validation.valid) {
            res.status(400).json({
              error: `Attachment '${file.originalname}' failed validation: ${validation.error}`
            });
            return;
          }

          validatedAttachments.push({
            filename: file.originalname,
            mimeType: validation.mimeType || file.mimetype,
            contentBase64: file.buffer.toString('base64'),
            sizeBytes: file.size
          });
        }

        const result = await checkEmailUseCase.execute({
          rawEmail,
          attachments: validatedAttachments,
          actor: req.actor || 'approver',
          policyConfig: {
            approvalLimit: config.APPROVAL_LIMIT,
            hardLimit: config.HARD_LIMIT
          }
        });

        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
