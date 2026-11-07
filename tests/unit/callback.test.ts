import { describe, it, expect } from 'vitest';
import { generateCallbackRecommendation } from '../../src/domain/callback.js';
import { Vendor } from '../../src/domain/types.js';

describe('Callback Verification Script Generator', () => {
  const vendorWithPhone: Vendor = {
    id: 'v1',
    name: 'Verified Vendor LLC',
    paypalEmails: ['finance@verified.com'],
    domains: ['verified.com'],
    phone: '+1-800-555-0199',
    typicalAmount: 500,
    paymentCount: 10,
    source: 'paypal',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const vendorWithoutPhone: Vendor = {
    ...vendorWithPhone,
    phone: null
  };

  const attackerEmailPhone = '+1-999-666-SCAM';

  it('uses ONLY vendor record phone and NEVER offers email-supplied phone numbers', () => {
    const rec = generateCallbackRecommendation({
      vendor: vendorWithPhone,
      verdict: 'HOLD',
      flags: [],
      amount: 450,
      newPayeeRequested: true,
      emailPhones: [attackerEmailPhone]
    });

    expect(rec.hasPhoneOnFile).toBe(true);
    expect(rec.phoneNumber).toBe('+1-800-555-0199');
    expect(rec.script).toContain('+1-800-555-0199');
    // Ensure the scam phone number from the email is NEVER present
    expect(rec.script).not.toContain(attackerEmailPhone);
    expect(rec.phoneNumber).not.toBe(attackerEmailPhone);
  });

  it('explicitly warns user when vendor has no phone number on file', () => {
    const rec = generateCallbackRecommendation({
      vendor: vendorWithoutPhone,
      verdict: 'HOLD',
      flags: [],
      amount: 450,
      newPayeeRequested: true,
      emailPhones: [attackerEmailPhone]
    });

    expect(rec.hasPhoneOnFile).toBe(false);
    expect(rec.phoneNumber).toBeNull();
    expect(rec.script).toContain('NO TRUSTED PHONE NUMBER ON FILE');
    expect(rec.script).toContain('DO NOT call any phone numbers listed inside the incoming email');
    expect(rec.script).not.toContain(attackerEmailPhone);
  });

  it('handles unknown vendor with strong safety warning', () => {
    const rec = generateCallbackRecommendation({
      vendor: null,
      verdict: 'HOLD',
      flags: [],
      amount: 1200,
      newPayeeRequested: false,
      emailPhones: ['+1-123-456-7890']
    });

    expect(rec.hasPhoneOnFile).toBe(false);
    expect(rec.phoneNumber).toBeNull();
    expect(rec.vendorName).toBe('Unknown Vendor');
    expect(rec.script).not.toContain('+1-123-456-7890');
  });
});
