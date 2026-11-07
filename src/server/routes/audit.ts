import { Router, Request, Response } from 'express';
import { IRepository } from '../../application/ports/repository.js';

export function createAuditRouter(repository: IRepository): Router {
  const router = Router();

  // 1. Get recent audit logs
  router.get('/', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const logs = repository.getAuditLogs(limit);
    res.json(logs);
  });

  // 2. Export audit logs as CSV
  router.get('/export.csv', (_req: Request, res: Response) => {
    const logs = repository.getAuditLogs(1000);

    const escapeCsv = (str: string) => `"${str.replace(/"/g, '""')}"`;

    const headers = ['id', 'timestamp', 'actor', 'action', 'target_id', 'details'];
    const rows = logs.map(l => [
      escapeCsv(l.id),
      escapeCsv(l.timestamp),
      escapeCsv(l.actor),
      escapeCsv(l.action),
      escapeCsv(l.targetId || ''),
      escapeCsv(JSON.stringify(l.details))
    ].join(','));

    const csvOutput = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="payguard_audit_trail.csv"');
    res.send(csvOutput);
  });

  return router;
}
