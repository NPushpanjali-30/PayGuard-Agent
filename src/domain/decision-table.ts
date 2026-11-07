import { Flag, Verdict } from './types.js';

export interface DecisionResult {
  verdict: Verdict;
  reason: string;
}

/**
 * Deterministic Decision Table.
 *
 * Rules:
 * 1. If email is not a payment request: CLEAR ("no payment request").
 * 2. HOLD:
 *    - Any HIGH severity flag present.
 *    - Payee change requested.
 *    - Lookalike domain detected.
 *    - Reply-to mismatch when payment is requested.
 * 3. CHECK:
 *    - Only MEDIUM or LOW flags present.
 *    - Announced future changes (payee_change_notice).
 *    - Cautious fallback reader with payment request (no_ai_reader).
 *    - Sender not on file or unknown vendor.
 * 4. CLEAR:
 *    - Payment request from a known sender, known payee, normal amount, ZERO flags.
 */
export function evaluateDecisionTable(
  paymentRequested: boolean,
  flags: Flag[]
): DecisionResult {
  if (!paymentRequested) {
    return {
      verdict: 'CLEAR',
      reason: 'No payment request detected in email. Routine correspondence.'
    };
  }

  const highFlags = flags.filter(f => f.severity === 'HIGH');
  const mediumFlags = flags.filter(f => f.severity === 'MEDIUM');
  const lowFlags = flags.filter(f => f.severity === 'LOW');

  // Specific HOLD conditions
  const hasPayeeChange = flags.some(f => f.id === 'payee_change' || f.id === 'bank_change');
  const hasLookalike = flags.some(f => f.id === 'lookalike_domain');
  const hasReplyToMismatch = flags.some(f => f.id === 'reply_to_mismatch');

  if (highFlags.length > 0 || hasPayeeChange || hasLookalike || hasReplyToMismatch) {
    const reasons = [
      ...highFlags.map(f => f.title),
      ...(hasPayeeChange && !highFlags.some(f => f.id === 'payee_change') ? ['Payee change requested'] : []),
      ...(hasLookalike && !highFlags.some(f => f.id === 'lookalike_domain') ? ['Lookalike domain detected'] : []),
      ...(hasReplyToMismatch && !highFlags.some(f => f.id === 'reply_to_mismatch') ? ['Reply-to mismatch'] : [])
    ];
    return {
      verdict: 'HOLD',
      reason: `High risk detected: ${Array.from(new Set(reasons)).join('; ')}. Immediate human out-of-band verification required.`
    };
  }

  // CHECK conditions
  if (mediumFlags.length > 0 || lowFlags.length > 0) {
    const reasons = mediumFlags.map(f => f.title);
    return {
      verdict: 'CHECK',
      reason: `Verification recommended: ${reasons.join('; ')}.`
    };
  }

  // CLEAR condition
  return {
    verdict: 'CLEAR',
    reason: 'Payment request matches verified vendor on file, registered payee, and established payment history with zero security flags.'
  };
}
