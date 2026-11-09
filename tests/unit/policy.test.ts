import { describe, it, expect } from 'vitest';
import { evaluatePolicy, validateApprovalPolicy, PolicyConfig } from '../../src/domain/policy.js';
import { PaymentProposal } from '../../src/domain/types.js';

describe('Payment Policy Enforcement', () => {
  const policyConfig: PolicyConfig = {
    approvalLimit: 500,
    hardLimit: 5000
  };

  const baseProposal: PaymentProposal = {
    id: 'prop-1',
    vendorId: 'v1',
    vendorName: 'Test Vendor',
    amount: 300,
    currency: 'USD',
    payee: 'payee@test.com',
    requestedPayeeInEmail: null,
    verdict: 'CLEAR',
    flags: [],
    status: 'PENDING_REVIEW',
    requiresCallbackCheck: false,
    requiresAmountConfirm: false,
    isHardBlocked: false,
    callbackConfirmed: false,
    callbackNote: null,
    approvalNote: null,
    rejectionReason: null,
    paypalBatchId: null,
    paypalPayoutItemId: null,
    rawEmail: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  it('evaluates policy flags correctly based on limits', () => {
    // Normal amount under limit
    const p1 = evaluatePolicy(300, 'CLEAR', policyConfig);
    expect(p1.requiresAmountConfirm).toBe(false);
    expect(p1.isHardBlocked).toBe(false);
    expect(p1.requiresCallbackCheck).toBe(false);

    // Amount over APPROVAL_LIMIT (500)
    const p2 = evaluatePolicy(750, 'CLEAR', policyConfig);
    expect(p2.requiresAmountConfirm).toBe(true);
    expect(p2.isHardBlocked).toBe(false);

    // Amount over HARD_LIMIT (5000)
    const p3 = evaluatePolicy(6000, 'CLEAR', policyConfig);
    expect(p3.isHardBlocked).toBe(true);

    // HOLD verdict mandates callback
    const p4 = evaluatePolicy(200, 'HOLD', policyConfig);
    expect(p4.requiresCallbackCheck).toBe(true);
  });

  it('allows approval of normal proposal with minimal input', () => {
    expect(() => {
      validateApprovalPolicy(baseProposal, {}, policyConfig);
    }).not.toThrow();
  });

  it('rejects approval when proposal has no verified payee on file', () => {
    const noPayeeProposal: PaymentProposal = {
      ...baseProposal,
      payee: null
    };

    expect(() => {
      validateApprovalPolicy(noPayeeProposal, {}, policyConfig);
    }).toThrow(/No verified payee on file/);

    const emptyPayeeProposal: PaymentProposal = {
      ...baseProposal,
      payee: '   '
    };

    expect(() => {
      validateApprovalPolicy(emptyPayeeProposal, {}, policyConfig);
    }).toThrow(/No verified payee on file/);
  });

  it('rejects approval of HOLD proposal without callback confirmation and note', () => {
    const holdProposal: PaymentProposal = {
      ...baseProposal,
      verdict: 'HOLD',
      requiresCallbackCheck: true
    };

    expect(() => {
      validateApprovalPolicy(holdProposal, {}, policyConfig);
    }).toThrow(/must confirm: "I called the verified number on file"/);

    expect(() => {
      validateApprovalPolicy(
        holdProposal,
        { callbackConfirmed: true, callbackNote: '' },
        policyConfig
      );
    }).toThrow(/descriptive callback note/);

    expect(() => {
      validateApprovalPolicy(
        holdProposal,
        {
          callbackConfirmed: true,
          callbackNote: 'Spoke with CFO Alice at verified phone number, verified invoice #99.'
        },
        policyConfig
      );
    }).not.toThrow();
  });

  it('demands typed amount confirmation when amount exceeds APPROVAL_LIMIT', () => {
    const highValueProposal: PaymentProposal = {
      ...baseProposal,
      amount: 1250,
      requiresAmountConfirm: true
    };

    expect(() => {
      validateApprovalPolicy(highValueProposal, {}, policyConfig);
    }).toThrow(/must type the exact amount/);

    expect(() => {
      validateApprovalPolicy(
        highValueProposal,
        { typedAmountConfirmation: 1000 },
        policyConfig
      );
    }).toThrow(/must type the exact amount/);

    expect(() => {
      validateApprovalPolicy(
        highValueProposal,
        { typedAmountConfirmation: 1250 },
        policyConfig
      );
    }).not.toThrow();
  });

  it('strictly blocks approval of transactions above HARD_LIMIT', () => {
    const hardBlockedProposal: PaymentProposal = {
      ...baseProposal,
      amount: 10000,
      isHardBlocked: true
    };

    expect(() => {
      validateApprovalPolicy(
        hardBlockedProposal,
        {
          callbackConfirmed: true,
          callbackNote: 'Verified',
          typedAmountConfirmation: 10000
        },
        policyConfig
      );
    }).toThrow(/exceeds hard limit/);
  });
});
