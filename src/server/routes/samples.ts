import { Router, Request, Response } from 'express';
import { SAMPLE_EMAILS } from '../../adapters/ai/sample-data.js';

export function createSamplesRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const list = SAMPLE_EMAILS.map(s => ({
      id: s.id,
      title: s.title,
      category: s.category,
      label: s.label,
      rawEmail: s.rawEmail,
      attachments: s.attachments?.map(a => ({
        filename: a.filename,
        mimeType: a.mimeType,
        contentBase64: a.contentBase64
      }))
    }));
    res.json(list);
  });

  return router;
}
