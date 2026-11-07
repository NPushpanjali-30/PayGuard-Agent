/**
 * Lookalike domain detector.
 * Identifies typosquatting, homoglyphs, swapped TLDs, and hyphen tricks
 * against trusted vendor domains on file.
 */

// Common homoglyphs and confusable character mappings
const HOMOGLYPH_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  'vv': 'w',
  'rn': 'm',
  'cl': 'd',
  // Cyrillic homoglyphs
  'а': 'a',
  'с': 'c',
  'е': 'e',
  'о': 'o',
  'р': 'p',
  'ѕ': 's',
  'х': 'x',
  'у': 'y',
  'і': 'i',
  'ј': 'j'
};

/**
 * Calculates Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // deletion
          dp[i][j - 1] + 1,     // insertion
          dp[i - 1][j - 1] + 1  // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Extracts second-level domain (SLD) and top-level domain (TLD)
 * e.g., "billing.acme-corp.co.uk" -> { sld: "acme-corp", tld: "co.uk", base: "acme-corp" }
 */
export function parseDomainParts(domain: string): { sld: string; tld: string; full: string } {
  const clean = domain.toLowerCase().trim().replace(/^\.+|\.+$/g, '');
  const parts = clean.split('.');
  
  if (parts.length <= 1) {
    return { sld: clean, tld: '', full: clean };
  }

  // Handle common two-part TLDs like .co.uk, .com.au
  const lastTwo = parts.slice(-2).join('.');
  const commonTwoPartTlds = ['co.uk', 'com.au', 'co.nz', 'com.br', 'co.za', 'com.mx'];
  
  if (parts.length >= 3 && commonTwoPartTlds.includes(lastTwo)) {
    const tld = lastTwo;
    const sld = parts[parts.length - 3];
    return { sld, tld, full: clean };
  }

  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  return { sld, tld, full: clean };
}

/**
 * Normalizes a string by converting homoglyphs to base latin characters.
 */
export function normalizeHomoglyphs(str: string): string {
  let normalized = str.toLowerCase();
  for (const [confusable, replacement] of Object.entries(HOMOGLYPH_MAP)) {
    normalized = normalized.replaceAll(confusable, replacement);
  }
  return normalized;
}

export interface LookalikeResult {
  isLookalike: boolean;
  trustedDomain?: string;
  reason?: string;
  trickType?: 'homoglyph' | 'edit_distance' | 'swapped_tld' | 'hyphen_insertion' | 'subdomain_spoof';
}

/**
 * Checks whether an incoming domain is a lookalike/spoof of any trusted domain.
 */
export function checkLookalikeDomain(
  incomingDomain: string,
  trustedDomains: string[]
): LookalikeResult {
  if (!incomingDomain) return { isLookalike: false };

  const inDomain = incomingDomain.toLowerCase().trim();
  const inParts = parseDomainParts(inDomain);

  for (const rawTrusted of trustedDomains) {
    const trusted = rawTrusted.toLowerCase().trim();
    if (!trusted) continue;

    // Exact match is legitimate, not a lookalike
    if (inDomain === trusted) {
      continue;
    }

    const trParts = parseDomainParts(trusted);

    // 1. Swapped TLD (same SLD, different TLD e.g., acme.co vs acme.com)
    if (inParts.sld === trParts.sld && inParts.tld !== trParts.tld && inParts.sld.length >= 3) {
      return {
        isLookalike: true,
        trustedDomain: trusted,
        trickType: 'swapped_tld',
        reason: `Swapped TLD: uses '${inParts.tld}' instead of trusted '${trParts.tld}' for '${trParts.sld}'`
      };
    }

    // 2. Hyphen tricks: e.g. "acme-corp.com" vs "acmecorp.com" or "acme-corp-billing.com"
    const inSldNoHyphens = inParts.sld.replace(/-/g, '');
    const trSldNoHyphens = trParts.sld.replace(/-/g, '');
    if (inSldNoHyphens === trSldNoHyphens && inParts.sld !== trParts.sld) {
      return {
        isLookalike: true,
        trustedDomain: trusted,
        trickType: 'hyphen_insertion',
        reason: `Hyphen manipulation on trusted domain base '${trParts.sld}'`
      };
    }
    if (inSldNoHyphens.includes(trSldNoHyphens) && inSldNoHyphens !== trSldNoHyphens) {
      // e.g. "acme-payments.com" or "reliable-cloud-pay.com"
      const extra = inSldNoHyphens.replace(trSldNoHyphens, '');
      const suspiciousWords = ['pay', 'payment', 'payments', 'billing', 'invoice', 'remit', 'finance', 'secure', 'portal', 'paypal', 'accounts'];
      if (suspiciousWords.some(w => extra.includes(w))) {
        return {
          isLookalike: true,
          trustedDomain: trusted,
          trickType: 'hyphen_insertion',
          reason: `Trusted brand name '${trParts.sld}' combined with suspicious keyword '${extra}'`
        };
      }
    }

    // 3. Homoglyph tricks: normalize and compare
    const inNorm = normalizeHomoglyphs(inParts.sld);
    const trNorm = normalizeHomoglyphs(trParts.sld);
    if (inNorm === trNorm && inParts.sld !== trParts.sld) {
      return {
        isLookalike: true,
        trustedDomain: trusted,
        trickType: 'homoglyph',
        reason: `Homoglyph / visual spoofing detected (e.g. 0 for o, rn for m, or Cyrillic characters)`
      };
    }

    // 4. Edit distance on SLD (Levenshtein distance <= 2 for SLDs of length >= 5)
    if (trParts.sld.length >= 4) {
      const dist = levenshteinDistance(inParts.sld, trParts.sld);
      if (dist === 1 || (dist === 2 && trParts.sld.length >= 7)) {
        return {
          isLookalike: true,
          trustedDomain: trusted,
          trickType: 'edit_distance',
          reason: `Typo-squatting edit distance of ${dist} between '${inParts.sld}' and trusted '${trParts.sld}'`
        };
      }
    }

    // 5. Subdomain spoofing: e.g. "acme.com.evil.com" or "evil.com.acme.com"
    if (
      inDomain.startsWith(trusted + '.') ||
      inDomain.includes('.' + trusted + '.') ||
      (inDomain.endsWith('.' + trusted) && inDomain !== trusted)
    ) {
      return {
        isLookalike: true,
        trustedDomain: trusted,
        trickType: 'subdomain_spoof',
        reason: `Subdomain spoof: incoming domain '${inDomain}' encapsulates trusted domain '${trusted}'`
      };
    }
  }

  return { isLookalike: false };
}
