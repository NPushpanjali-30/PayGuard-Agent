import { describe, it, expect } from 'vitest';
import { checkLookalikeDomain, levenshteinDistance, normalizeHomoglyphs } from '../../src/domain/lookalike.js';

describe('Lookalike Domain Detection', () => {
  const trustedDomains = ['acme-corp.com', 'supplychain.io', 'quickbooks.com'];

  it('calculates correct Levenshtein distance', () => {
    expect(levenshteinDistance('acme', 'acme')).toBe(0);
    expect(levenshteinDistance('acme', 'akme')).toBe(1);
    expect(levenshteinDistance('paypal', 'paypa1')).toBe(1);
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('normalizes common homoglyphs', () => {
    expect(normalizeHomoglyphs('p0rtal')).toBe('portal');
    expect(normalizeHomoglyphs('b1lling')).toBe('bllling');
    expect(normalizeHomoglyphs('pаypаl')).toBe('paypal'); // Cyrillic 'а'
  });

  it('flags swapped TLD lookalikes', () => {
    const result = checkLookalikeDomain('acme-corp.co', trustedDomains);
    expect(result.isLookalike).toBe(true);
    expect(result.trickType).toBe('swapped_tld');
    expect(result.trustedDomain).toBe('acme-corp.com');
  });

  it('flags typo-squatting edit distance lookalikes', () => {
    const result = checkLookalikeDomain('acme-corq.com', trustedDomains);
    expect(result.isLookalike).toBe(true);
    expect(result.trickType).toBe('edit_distance');
  });

  it('flags hyphen insertion/manipulation tricks', () => {
    const result1 = checkLookalikeDomain('acm-ecorp.com', ['acmecorp.com']);
    expect(result1.isLookalike).toBe(true);

    const result2 = checkLookalikeDomain('acme-payments.com', ['acme.com']);
    expect(result2.isLookalike).toBe(true);
    expect(result2.trickType).toBe('hyphen_insertion');
  });

  it('flags homoglyph visual spoofing', () => {
    const result = checkLookalikeDomain('acme-c0rp.com', trustedDomains);
    expect(result.isLookalike).toBe(true);
    expect(result.trickType).toBe('homoglyph');
  });

  it('flags subdomain spoofing', () => {
    const result = checkLookalikeDomain('acme-corp.com.evilattacker.com', trustedDomains);
    expect(result.isLookalike).toBe(true);
    expect(result.trickType).toBe('subdomain_spoof');
  });

  it('passes exact trusted domain match as clean', () => {
    const result = checkLookalikeDomain('acme-corp.com', trustedDomains);
    expect(result.isLookalike).toBe(false);
  });

  it('passes completely unrelated domain without false alarms', () => {
    const result = checkLookalikeDomain('google.com', trustedDomains);
    expect(result.isLookalike).toBe(false);
  });
});
