import { describe, it, expect } from 'vitest';
import { evaluateDecisionTable } from '../../src/domain/decision-table.js';
import { Flag } from '../../src/domain/types.js';

describe('Deterministic Decision Table', () => {
  it('returns CLEAR with note for non-payment emails even if minor flags exist', () => {
    const flags: Flag[] = [
      { id: 'subdomain_sender', severity: 'MEDIUM', title: 'Subdomain', evidence: '...' }
    ];
    const decision = evaluateDecisionTable(false, flags);
    expect(decision.verdict).toBe('CLEAR');
    expect(decision.reason).toContain('No payment request detected');
  });

  it('returns CLEAR for clean payment requests with zero flags', () => {
    const decision = evaluateDecisionTable(true, []);
    expect(decision.verdict).toBe('CLEAR');
    expect(decision.reason).toContain('zero security flags');
  });

  it('returns HOLD if any HIGH severity flag is present', () => {
    const flags: Flag[] = [
      { id: 'gift_cards', severity: 'HIGH', title: 'Gift card request', evidence: 'Apple gift cards' }
    ];
    const decision = evaluateDecisionTable(true, flags);
    expect(decision.verdict).toBe('HOLD');
    expect(decision.reason).toContain('High risk detected');
  });

  it('returns HOLD if payee change is requested', () => {
    const flags: Flag[] = [
      { id: 'payee_change', severity: 'HIGH', title: 'Payee change requested', evidence: 'New bank account' }
    ];
    const decision = evaluateDecisionTable(true, flags);
    expect(decision.verdict).toBe('HOLD');
  });

  it('returns HOLD if lookalike domain is detected', () => {
    const flags: Flag[] = [
      { id: 'lookalike_domain', severity: 'HIGH', title: 'Lookalike domain', evidence: 'acme.co vs acme.com' }
    ];
    const decision = evaluateDecisionTable(true, flags);
    expect(decision.verdict).toBe('HOLD');
  });

  it('returns HOLD if reply-to mismatch occurs on a payment request', () => {
    const flags: Flag[] = [
      { id: 'reply_to_mismatch', severity: 'HIGH', title: 'Reply-To mismatch', evidence: 'mismatch' }
    ];
    const decision = evaluateDecisionTable(true, flags);
    expect(decision.verdict).toBe('HOLD');
  });

  it('returns CHECK if only MEDIUM/LOW flags exist', () => {
    const flags: Flag[] = [
      { id: 'sender_not_on_file', severity: 'MEDIUM', title: 'Sender not on file', evidence: '...' },
      { id: 'amount_anomaly', severity: 'MEDIUM', title: 'Amount anomaly', evidence: '...' }
    ];
    const decision = evaluateDecisionTable(true, flags);
    expect(decision.verdict).toBe('CHECK');
    expect(decision.reason).toContain('Verification recommended');
  });

  it('returns CHECK for fallback reader without an AI key (never bare CLEAR)', () => {
    const flags: Flag[] = [
      { id: 'no_ai_reader', severity: 'MEDIUM', title: 'Cautious Fallback Mode', evidence: '...' }
    ];
    const decision = evaluateDecisionTable(true, flags);
    expect(decision.verdict).toBe('CHECK');
  });
});
