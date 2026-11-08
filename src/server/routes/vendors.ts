import crypto from 'node:crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { IRepository } from '../../application/ports/repository.js';
import { UpdateVendorPayeeUseCase } from '../../application/use-cases/update-vendor-payee.js';
import { SyncHistoryUseCase } from '../../application/use-cases/sync-history.js';
import { importVendorsFromCsv, getSampleCsvTemplate } from '../../adapters/csv/csv-importer.js';
import { Vendor } from '../../domain/types.js';

export function createVendorsRouter(
  repository: IRepository,
  updateVendorPayeeUseCase: UpdateVendorPayeeUseCase,
  syncHistoryUseCase: SyncHistoryUseCase
): Router {
  const router = Router();

  // 1. List all vendors
  router.get('/', (_req: Request, res: Response) => {
    const vendors = repository.getAllVendors();
    res.json(vendors);
  });

  // 2. Add vendor manually
  const addVendorSchema = z.object({
    name: z.string().min(2, 'Vendor name is required'),
    payeeEmail: z.string().email('Valid PayPal email is required'),
    contactEmail: z.string().email('Valid contact email is required').optional().nullable().or(z.literal('')),
    domains: z.array(z.string()).optional().default([]),
    phone: z.string().optional().nullable(),
    typicalAmount: z.number().nonnegative().optional().default(0)
  });

  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = addVendorSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const now = new Date().toISOString();
      const domainList = [...parsed.data.domains];
      if (domainList.length === 0 && parsed.data.payeeEmail.includes('@')) {
        const d = parsed.data.payeeEmail.split('@')[1];
        if (!['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'].includes(d)) {
          domainList.push(d);
        }
      }

      const contactEmail = parsed.data.contactEmail && parsed.data.contactEmail.trim().length > 0
        ? parsed.data.contactEmail.trim().toLowerCase()
        : null;

      const vendor: Vendor = {
        id: 'ven_' + crypto.randomUUID().slice(0, 10),
        name: parsed.data.name,
        paypalEmails: [parsed.data.payeeEmail.toLowerCase()],
        domains: domainList,
        phone: parsed.data.phone || null,
        contactEmail,
        typicalAmount: parsed.data.typicalAmount,
        paymentCount: 1,
        source: 'manual',
        createdAt: now,
        updatedAt: now
      };

      repository.saveVendor(vendor);

      repository.addAuditLog({
        action: 'VENDOR_CREATED',
        actor: req.actor || 'approver',
        targetId: vendor.id,
        details: { name: vendor.name, payee: vendor.paypalEmails[0], contactEmail }
      });

      res.status(201).json(vendor);
    } catch (err) {
      next(err);
    }
  });

  // 3. Update payee on file (logged with mandatory reason)
  const updatePayeeSchema = z.object({
    newPayee: z.string().email('Valid PayPal email is required'),
    reason: z.string().min(5, 'Reason must be at least 5 characters explaining how the payee change was verified')
  });

  router.put('/:id/payee', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updatePayeeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const updated = updateVendorPayeeUseCase.execute({
        vendorId: req.params.id,
        newPayeeEmail: parsed.data.newPayee,
        actor: req.actor || 'approver',
        reason: parsed.data.reason
      });

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 3b. Update verified contact email on file
  const updateContactEmailSchema = z.object({
    contactEmail: z.string().email('Valid contact email is required').nullable().or(z.literal(''))
  });

  router.put('/:id/contact-email', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateContactEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const cleanEmail = parsed.data.contactEmail && parsed.data.contactEmail.trim().length > 0
        ? parsed.data.contactEmail.trim().toLowerCase()
        : null;

      repository.updateVendorContactEmail(req.params.id, cleanEmail, req.actor || 'approver');
      const updated = repository.getVendorById(req.params.id);
      if (!updated) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 4. Download CSV template
  router.get('/template.csv', (_req: Request, res: Response) => {
    const template = getSampleCsvTemplate();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="payguard_vendor_template.csv"');
    res.send(template);
  });

  // 5. Import CSV vendors
  router.post('/import-csv', (req: Request, res: Response, next: NextFunction) => {
    try {
      let csvContent = '';
      if (typeof req.body === 'string') {
        csvContent = req.body;
      } else if (req.body && typeof req.body.csvContent === 'string') {
        csvContent = req.body.csvContent;
      } else {
        res.status(400).json({ error: 'Expected csvContent string in request body' });
        return;
      }

      const result = importVendorsFromCsv(csvContent);

      // Save imported vendors
      repository.runInTransaction(() => {
        for (const v of result.vendors) {
          repository.saveVendor(v);
        }
      });

      repository.addAuditLog({
        action: 'VENDORS_IMPORTED_CSV',
        actor: req.actor || 'approver',
        targetId: null,
        details: { count: result.importedCount, errors: result.errors }
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // 6. Sync history from PayPal
  router.post('/sync-paypal', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const syncResult = await syncHistoryUseCase.execute(req.actor || 'approver');
      res.json(syncResult);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
