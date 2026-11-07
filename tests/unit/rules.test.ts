import { describe, it, expect } from 'vitest';
import { evaluateRules } from '../../src/domain/rules.js';
import { Vendor, ParsedEmail, EmailAIAnalysis, BackstopSignals } from '../../src/domain/types.js';

describe('16-Rule Checklist Evaluation', () => {
  const dummyVendor: Vendor = {
    id: 'v1',
    name: 'Reliable Cloud Inc',
    paypalEmails: ['billing@reliablecloud.com'],
    domains: ['reliablecloud.com'],
    phone: '+1-555-0199',
    typicalAmount: 450,
    paymentCount: 12,
    source: 'paypal',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const defaultParsedEmail: ParsedEmail = {
    senderName: 'Reliable Cloud Billing',
    senderAddress: 'billing@reliablecloud.com',
    senderDomain: 'reliablecloud.com',
    subject: 'Invoice #1094',
    body: 'Please pay invoice #1094 for monthly server hosting.',
    headers: {},
    raw: '...'
  };

  const defaultAI: EmailAIAnalysis = {
    vendorName: 'Reliable Cloud Inc',
    paymentRequested: true,
    payeeChangeRequested: false,
    payeeChangeMentioned: false,
    newPayeeIdentifiers: [],
    amount: 450,
    currency: 'USD',
    tactics: { urgency: false, secrecy: false, authority: false, avoid_phone: false },
    channelShift: false,
    giftCards: false,
    phonesInEmail: []
  };

  const cleanBackstop: BackstopSignals = {
    ibanFound: [],
    accountNumbersFound: [],
    cryptoOrGiftCards: false,
    paymentChangePhrases: [],
    remitToBlock: null,
    paypalEmailsFound: ['billing@reliablecloud.com']
  };

  it('evaluates completely clean routine invoice with 0 flags', () => {
    const flags = evaluateRules({
      parsedEmail: defaultParsedEmail,
      aiAnalysis: defaultAI,
      secondOpinion: null,
      backstop: cleanBackstop,
      matchedVendor: dummyVendor,
      allKnownVendors: [dummyVendor],
      isFallbackReader: false
    });
    expect(flags).toHaveLength(0);
  });

  it('flags payee_change when AI or backstop detects new payee', () => {
    const flags = evaluateRules({
      parsedEmail: defaultParsedEmail,
      aiAnalysis: { ...defaultAI, payeeChangeRequested: true },
      secondOpinion: null,
      backstop: {
        ...cleanBackstop,
        paymentChangePhrases: ['[EN] "changed our bank details"'],
        ibanFound: ['GB29NWBK60161331926819']
      },
      matchedVendor: dummyVendor,
      allKnownVendors: [dummyVendor],
      isFallbackReader: false
    });

    const payeeChange = flags.find(f => f.id === 'payee_change');
    expect(payeeChange).toBeDefined();
    expect(payeeChange?.severity).toBe('HIGH');
  });

  it('flags lookalike_domain with HIGH severity', () => {
    const spoofedEmail: ParsedEmail = {
      ...defaultParsedEmail,
      senderDomain: 'reliable-cloud.co'
    };

    const flags = evaluateRules({
      parsedEmail: spoofedEmail,
      aiAnalysis: defaultAI,
      secondOpinion: null,
      backstop: cleanBackstop,
      matchedVendor: dummyVendor,
      allKnownVendors: [dummyVendor],
      isFallbackReader: false
    });

    const lookalike = flags.find(f => f.id === 'lookalike_domain');
    expect(lookalike).toBeDefined();
    expect(lookalike?.severity).toBe('HIGH');
  });

  it('flags reply_to_mismatch as HIGH when payment is requested', () => {
    const mismatchEmail: ParsedEmail = {
      ...defaultParsedEmail,
      replyToDomain: 'attacker-inbox.com',
      replyToAddress: 'drop@attacker-inbox.com'
    };

    const flags = evaluateRules({
      parsedEmail: mismatchEmail,
      aiAnalysis: defaultAI,
      secondOpinion: null,
      backstop: cleanBackstop,
      matchedVendor: dummyVendor,
      allKnownVendors: [dummyVendor],
      isFallbackReader: false
    });

    const replyToFlag = flags.find(f => f.id === 'reply_to_mismatch');
    expect(replyToFlag).toBeDefined();
    expect(replyToFlag?.severity).toBe('HIGH');
  });

  it('flags amount_anomaly when amount exceeds 3x vendor median', () => {
    const flags = evaluateRules({
      parsedEmail: defaultParsedEmail,
      aiAnalysis: { ...defaultAI, amount: 2500 }, // 2500 > 3 * 450 (1350)
      secondOpinion: null,
      backstop: cleanBackstop,
      matchedVendor: dummyVendor,
      allKnownVendors: [dummyVendor],
      isFallbackReader: false
    });

    const anomalyFlag = flags.find(f => f.id === 'amount_anomaly');
    expect(anomalyFlag).toBeDefined();
    expect(anomalyFlag?.severity).toBe('MEDIUM');
  });

  it('flags auth_fail if SPF, DKIM, or DMARC fail in headers', () => {
    const authFailedEmail: ParsedEmail = {
      ...defaultParsedEmail,
      headers: {
        authResults: 'mx.google.com; dkim=fail header.i=@reliablecloud.com; spf=fail (google.com: domain of evil.com does not designate permitted sender)'
      }
    };

    const flags = evaluateRules({
      parsedEmail: authFailedEmail,
      aiAnalysis: defaultAI,
      secondOpinion: null,
      backstop: cleanBackstop,
      matchedVendor: dummyVendor,
      allKnownVendors: [dummyVendor],
      isFallbackReader: false
    });

    const authFlag = flags.find(f => f.id === 'auth_fail');
    expect(authFlag).toBeDefined();
    expect(authFlag?.severity).toBe('HIGH');
  });

  it('flags no_ai_reader when fallback reader is used on payment email', () => {
    const flags = evaluateRules({
      parsedEmail: defaultParsedEmail,
      aiAnalysis: defaultAI,
      secondOpinion: null,
      backstop: cleanBackstop,
      matchedVendor: dummyVendor,
      allKnownVendors: [dummyVendor],
      isFallbackReader: true
    });

    const fallbackFlag = flags.find(f => f.id === 'no_ai_reader');
    expect(fallbackFlag).toBeDefined();
  });
});
