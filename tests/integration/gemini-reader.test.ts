import { describe, it, expect, vi } from 'vitest';
import { GeminiReader } from '../../src/adapters/ai/gemini-reader.js';
import { ParsedEmail } from '../../src/domain/types.js';

describe('GeminiReader Adapter Tests', () => {
  const sampleEmail: ParsedEmail = {
    senderName: 'Test Vendor',
    senderAddress: 'billing@testvendor.com',
    senderDomain: 'testvendor.com',
    subject: 'Invoice #5001 for Web Hosting',
    body: 'Please pay invoice #5001 for $300.00 USD by Friday.',
    headers: { from: 'billing@testvendor.com' },
    raw: '...'
  };

  it('parses valid structured JSON from Gemini API', async () => {
    const reader = new GeminiReader('fake-api-key');

    const fakeResponse = {
      text: JSON.stringify({
        vendorName: 'Test Vendor',
        paymentRequested: true,
        payeeChangeRequested: false,
        payeeChangeMentioned: false,
        newPayeeIdentifiers: [],
        amount: 300.0,
        currency: 'USD',
        tactics: {
          urgency: false,
          secrecy: false,
          authority: false,
          avoid_phone: false
        },
        channelShift: false,
        giftCards: false,
        phonesInEmail: []
      })
    };

    (reader as any).ai.models.generateContent = vi.fn().mockResolvedValue(fakeResponse);

    const result = await reader.readEmail(sampleEmail);
    expect(result.paymentRequested).toBe(true);
    expect(result.amount).toBe(300.0);
    expect(result.payeeChangeRequested).toBe(false);
  });

  it('falls back safely to KeywordReader when Gemini returns invalid or corrupted JSON', async () => {
    const reader = new GeminiReader('fake-api-key');

    // Simulate invalid malformed JSON
    (reader as any).ai.models.generateContent = vi.fn().mockResolvedValue({
      text: 'Malformed { not json at all!'
    });

    const result = await reader.readEmail(sampleEmail);
    // Should safely fallback to KeywordReader rather than throwing!
    expect(result).toBeDefined();
    expect(result.paymentRequested).toBe(true);
    expect(result.amount).toBe(300.0);
  });

  it('falls back safely to KeywordReader when Gemini API throws network or auth errors', async () => {
    const reader = new GeminiReader('fake-api-key');

    (reader as any).ai.models.generateContent = vi
      .fn()
      .mockRejectedValue(new Error('503 Service Unavailable: High load'));

    const result = await reader.readEmail(sampleEmail);
    expect(result).toBeDefined();
    expect(result.paymentRequested).toBe(true);
  });
});
