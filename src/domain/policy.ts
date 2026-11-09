import { PaymentProposal, Verdict } from './types.js';

export interface PolicyConfig {
  approvalLimit: number; // e.g., 500 USD
  hardLimit: number;     // e.g., 5000 USD
  dualApprovalThreshold?: number; // e.g., 1000 USD
  coolingOffHours?: number;       // e.g., 24 hours
}

export interface ApprovalActionInput {
  callbackConfirmed?: boolean;
  callbackNote?: string;
  typedAmountConfirmation?: number;
  approvalNote?: string;
  isVendorConfirmed?: boolean;
}

export interface PolicyEvaluationResult {
  requiresCallbackCheck: boolean;
  requiresAmountConfirm: boolean;
  isHardBlocked: boolean;
  blockReason?: string;
}

/**
 * Calculates policy constraints for a payment proposal based on verdict and amount.
 */
export function evaluatePolicy(
  amount: number,
  verdict: Verdict,
  config: PolicyConfig
): PolicyEvaluationResult {
  const isHardBlocked = amount > config.hardLimit;
  const requiresAmountConfirm = amount > config.approvalLimit && !isHardBlocked;
  const requiresCallbackCheck = verdict === 'HOLD';

  let blockReason: string | undefined;
  if (isHardBlocked) {
    blockReason = `Amount $${amount.toFixed(2)} exceeds hard threshold $${config.hardLimit.toFixed(2)}. In-app automated payout is disabled. Out-of-band wire authorization required.`;
  }

  return {
    requiresCallbackCheck,
    requiresAmountConfirm,
    isHardBlocked,
    blockReason
  };
}

/**
 * Validates whether a human approval action satisfies all policy constraints.
 * Throws an Error with an explanatory message if any constraint is violated.
 */
export function validateApprovalPolicy(
  proposal: PaymentProposal,
  input: ApprovalActionInput,
  config: PolicyConfig
): void {
  // 0. Payee on file check: proposal must have a verified payee on file
  if (!proposal.payee || proposal.payee.trim() === '') {
    throw new Error(
      'Cannot approve proposal: No verified payee on file. Please add the vendor on the Vendors page first.'
    );
  }

  // 1. Status check: proposal must be PENDING_REVIEW
  if (proposal.status !== 'PENDING_REVIEW') {
    throw new Error(`Proposal cannot be approved in status '${proposal.status}' (must be PENDING_REVIEW).`);
  }

  // 2. Hard limit check
  if (proposal.amount > config.hardLimit || proposal.isHardBlocked) {
    throw new Error(
      `Transaction exceeds hard limit ($${config.hardLimit}). Payouts over this limit are hard-blocked and cannot be approved through this app.`
    );
  }

  // 3. HOLD proposals mandate either out-of-band vendor confirmation OR callback confirmation and note
  if (proposal.verdict === 'HOLD' || proposal.requiresCallbackCheck) {
    const hasVendorConfirmed = Boolean(input.isVendorConfirmed);
    const hasCallback = Boolean(input.callbackConfirmed && input.callbackNote && input.callbackNote.trim().length >= 5);

    if (!hasVendorConfirmed && !hasCallback) {
      if (!input.callbackConfirmed) {
        throw new Error(
          'For HOLD proposals, out-of-band vendor confirmation must be CONFIRMED or you must confirm: "I called the verified number on file" before approving.'
        );
      }
      if (!input.callbackNote || input.callbackNote.trim().length < 5) {
        throw new Error(
          'A descriptive callback note (min 5 characters) is required explaining who verified the invoice.'
        );
      }
    }
  }

  // 4. Amount above APPROVAL_LIMIT requires typing the exact amount to prevent rubber-stamping
  if (proposal.amount > config.approvalLimit || proposal.requiresAmountConfirm) {
    if (
      input.typedAmountConfirmation === undefined ||
      Math.abs(input.typedAmountConfirmation - proposal.amount) > 0.01
    ) {
      throw new Error(
        `Amount exceeds $${config.approvalLimit}. You must type the exact amount ($${proposal.amount.toFixed(2)}) to confirm.`
      );
    }
  }
}
