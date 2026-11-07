import { describe, it, expect } from 'vitest';
import { scanBackstop } from '../../src/domain/backstop.js';

describe('Deterministic Backstop Scanner', () => {
  it('detects European IBANs', () => {
    const text = 'Please wire the payment to our European treasury: GB29NWBK60161331926819 immediately.';
    const result = scanBackstop(text);
    expect(result.ibanFound).toContain('GB29NWBK60161331926819');
  });

  it('detects German IBANs and account numbers', () => {
    const text = 'Bank Details: DE89370400440532013000, Account Number: 9876543210.';
    const result = scanBackstop(text);
    expect(result.ibanFound).toContain('DE89370400440532013000');
    expect(result.accountNumbersFound).toContain('9876543210');
  });

  it('extracts multi-line Remit to blocks accurately', () => {
    const text = `
Hello,

Invoice #4092 is attached for your review.

Remit to:
Acme Corporation
First National Bank
Account: 123456789
Routing: 987654321
Swift: FNBKUS33

Thank you for your prompt payment!
`;
    const result = scanBackstop(text);
    expect(result.remitToBlock).not.toBeNull();
    expect(result.remitToBlock).toContain('First National Bank');
    expect(result.remitToBlock).toContain('Account: 123456789');
  });

  it('detects payment change announcement phrases in English', () => {
    const text = 'We changed our bank details for this quarter. Please send all future payments to our new account.';
    const result = scanBackstop(text);
    expect(result.paymentChangePhrases.length).toBeGreaterThanOrEqual(1);
    expect(result.paymentChangePhrases.some(p => p.includes('[EN]'))).toBe(true);
  });

  it('detects payment change announcement phrases in Spanish', () => {
    const text = 'Estimado cliente, le informamos sobre un cambio de datos bancarios para las próximas facturas.';
    const result = scanBackstop(text);
    expect(result.paymentChangePhrases.some(p => p.includes('[ES]'))).toBe(true);
  });

  it('detects payment change announcement phrases in French', () => {
    const text = 'Veuillez noter un changement de coordonnées bancaires pour notre société.';
    const result = scanBackstop(text);
    expect(result.paymentChangePhrases.some(p => p.includes('[FR]'))).toBe(true);
  });

  it('detects payment change announcement phrases in German', () => {
    const text = 'Sehr geehrte Damen und Herren, bitte beachten Sie unsere neue Bankverbindung.';
    const result = scanBackstop(text);
    expect(result.paymentChangePhrases.some(p => p.includes('[DE]'))).toBe(true);
  });

  it('detects payment change announcement phrases in Portuguese', () => {
    const text = 'Informamos que houve uma alteração dos dados bancários da nossa empresa.';
    const result = scanBackstop(text);
    expect(result.paymentChangePhrases.some(p => p.includes('[PT]'))).toBe(true);
  });

  it('detects crypto and gift card solicitations', () => {
    const text1 = 'Please purchase 5 Apple gift cards of $100 each for the vendor bonus.';
    expect(scanBackstop(text1).cryptoOrGiftCards).toBe(true);

    const text2 = 'We now accept settlement via Bitcoin wallet 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.';
    expect(scanBackstop(text2).cryptoOrGiftCards).toBe(true);
  });
});
