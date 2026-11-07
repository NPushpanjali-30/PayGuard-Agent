import crypto from 'node:crypto';
import { Vendor } from '../../domain/types.js';

export interface CsvImportResult {
  importedCount: number;
  vendors: Vendor[];
  errors: string[];
}

export function getSampleCsvTemplate(): string {
  return [
    'vendor,payee_email,amount,phone,domain',
    'Acme Supplies,billing@acme-supplies.com,450.00,+1-555-0144,acme-supplies.com',
    'Global Logistics Ltd,payments@globallogistics.io,1200.00,+44-20-7946-0912,globallogistics.io',
    'Apex Office Solutions,apex-accounts@gmail.com,275.50,+1-555-0188,apexoffice.net'
  ].join('\n');
}

/**
 * Parses a CSV string with header tolerance and ',' or ';' delimiters.
 */
export function importVendorsFromCsv(csvContent: string): CsvImportResult {
  const lines = csvContent
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    return { importedCount: 0, vendors: [], errors: ['CSV content is empty'] };
  }

  // Detect delimiter from header line
  const headerLine = lines[0];
  const delimiter = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';

  // Helper to split a CSV line respecting quotes
  const parseLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        values.push(current.trim().replace(/^["']|["']$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^["']|["']$/g, ''));
    return values;
  };

  const headers = parseLine(headerLine).map(h => h.toLowerCase().replace(/[\s_-]+/g, ''));

  // Header mapping synonyms
  const findHeaderIndex = (synonyms: string[]): number => {
    for (const syn of synonyms) {
      const cleanSyn = syn.toLowerCase().replace(/[\s_-]+/g, '');
      const idx = headers.findIndex(h => h === cleanSyn || h.includes(cleanSyn) || cleanSyn.includes(h));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const vendorIdx = findHeaderIndex(['vendor', 'vendorname', 'companyname', 'company', 'name', 'supplier', 'businessname']);
  const payeeIdx = findHeaderIndex(['payeeemail', 'payee', 'paypalemail', 'paypal', 'email', 'recipientemail']);
  const amountIdx = findHeaderIndex(['amount', 'typicalamount', 'medianamount', 'avgamount', 'cost']);
  const phoneIdx = findHeaderIndex(['phone', 'phonenumber', 'telephone', 'contactphone', 'tel']);
  const domainIdx = findHeaderIndex(['domain', 'domains', 'website', 'domainname', 'url']);

  if (vendorIdx === -1 || payeeIdx === -1) {
    return {
      importedCount: 0,
      vendors: [],
      errors: ['CSV must contain at least "vendor" and "payee_email" columns']
    };
  }

  const vendors: Vendor[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length <= 1 && cols[0] === '') continue;

    const name = cols[vendorIdx]?.trim();
    const payee = cols[payeeIdx]?.trim().toLowerCase();

    if (!name || !payee) {
      errors.push(`Row ${i + 1}: Missing vendor name or payee email.`);
      continue;
    }

    const typicalAmount = amountIdx !== -1 && cols[amountIdx] ? parseFloat(cols[amountIdx].replace(/[^0-9.]/g, '')) || 0 : 0;
    const phone = phoneIdx !== -1 && cols[phoneIdx] ? cols[phoneIdx].trim() : null;

    let domains: string[] = [];
    if (domainIdx !== -1 && cols[domainIdx]) {
      domains = cols[domainIdx].split(/[,|;]/).map(d => d.trim().toLowerCase()).filter(Boolean);
    }

    // If no domain provided, derive domain from payee email if corporate
    if (domains.length === 0 && payee.includes('@')) {
      const domainCandidate = payee.split('@')[1];
      const freeMails = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
      if (!freeMails.includes(domainCandidate)) {
        domains.push(domainCandidate);
      }
    }

    const vendor: Vendor = {
      id: 'ven_' + crypto.randomUUID().slice(0, 12),
      name,
      paypalEmails: [payee],
      domains,
      phone: phone || null,
      typicalAmount,
      paymentCount: 1,
      source: 'csv',
      createdAt: now,
      updatedAt: now
    };

    vendors.push(vendor);
  }

  return {
    importedCount: vendors.length,
    vendors,
    errors
  };
}
