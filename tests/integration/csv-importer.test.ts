import { describe, it, expect } from 'vitest';
import { importVendorsFromCsv, getSampleCsvTemplate } from '../../src/adapters/csv/csv-importer.js';

describe('CSV Importer Tests', () => {
  it('provides a valid sample CSV template', () => {
    const template = getSampleCsvTemplate();
    expect(template).toContain('vendor,payee_email,amount,phone,domain');
    const result = importVendorsFromCsv(template);
    expect(result.importedCount).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('handles semicolon delimiters and header synonyms', () => {
    const csvWithSemicolon = [
      'Company Name;PayPal Email;Typical Amount;Telephone;Website',
      'Northern Freight;finance@northernfreight.co.uk;850.00;+44-161-496-0123;northernfreight.co.uk',
      'Tech Components;sales@techcomp.de;1250.50;+49-30-123456;techcomp.de'
    ].join('\n');

    const result = importVendorsFromCsv(csvWithSemicolon);
    expect(result.importedCount).toBe(2);
    expect(result.vendors[0].name).toBe('Northern Freight');
    expect(result.vendors[0].paypalEmails[0]).toBe('finance@northernfreight.co.uk');
    expect(result.vendors[0].typicalAmount).toBe(850.0);
    expect(result.vendors[1].name).toBe('Tech Components');
  });

  it('reports errors for missing essential columns', () => {
    const invalidCsv = 'city,zipcode\nNew York,10001';
    const result = importVendorsFromCsv(invalidCsv);
    expect(result.importedCount).toBe(0);
    expect(result.errors[0]).toContain('must contain at least "vendor" and "payee_email"');
  });
});
