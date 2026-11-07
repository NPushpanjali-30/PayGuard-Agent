import crypto from 'node:crypto';
import { parseRawEmail } from '../../domain/email-parser.js';
import { scanBackstop } from '../../domain/backstop.js';
import { evaluateRules } from '../../domain/rules.js';
import { evaluateDecisionTable } from '../../domain/decision-table.js';
import { generateCallbackRecommendation } from '../../domain/callback.js';
import { evaluatePolicy } from '../../domain/policy.js';
import { IRepository } from '../ports/repository.js';
import { IEmailReader } from '../ports/email-reader.js';
import { ISecondOpinionJudge } from '../ports/second-opinion.js';
import { RecordedReader } from '../../adapters/ai/recorded-reader.js';
import { CheckEmailResult, PaymentProposal } from '../../domain/types.js';

export interface CheckEmailOptions {
  rawEmail: string;
  actor?: string;
  policyConfig: {
    approvalLimit: number;
    hardLimit: number;
  };
}

export class CheckEmailUseCase {
  private repository: IRepository;
  private emailReader: IEmailReader;
  private secondOpinionJudge: ISecondOpinionJudge | null;
  private recordedReader: RecordedReader;

  constructor(
    repository: IRepository,
    emailReader: IEmailReader,
    secondOpinionJudge: ISecondOpinionJudge | null = null
  ) {
    this.repository = repository;
    this.emailReader = emailReader;
    this.secondOpinionJudge = secondOpinionJudge;
    this.recordedReader = new RecordedReader();
  }

  async execute(options: CheckEmailOptions): Promise<CheckEmailResult> {
    const { rawEmail, actor = 'approver', policyConfig } = options;

    // 1. Pure domain parsing
    const parsedEmail = parseRawEmail(rawEmail);
    const backstop = scanBackstop(rawEmail);

    // 2. Check if this is one of our recorded sample emails
    let aiAnalysis;
    let secondOpinion = null;
    let isFallback = this.emailReader.isFallback;

    const sampleMatch = this.recordedReader.findSample(parsedEmail);
    if (sampleMatch) {
      aiAnalysis = sampleMatch.recordedReading;
      secondOpinion = sampleMatch.recordedSecondOpinion;
      isFallback = false;
    } else {
      // Use active reader (Gemini or Fallback Keyword reader)
      aiAnalysis = await this.emailReader.readEmail(parsedEmail);
      if (this.secondOpinionJudge) {
        secondOpinion = await this.secondOpinionJudge.evaluateSecondOpinion(parsedEmail, aiAnalysis);
      }
    }

    // 3. Find matched vendor in repository
    const allVendors = this.repository.getAllVendors();
    const matchedVendor = this.repository.findVendorByDomainOrName(
      parsedEmail.senderDomain,
      aiAnalysis.vendorName || parsedEmail.senderName
    );

    // 4. Evaluate 16 security rules
    const flags = evaluateRules({
      parsedEmail,
      aiAnalysis,
      secondOpinion,
      backstop,
      matchedVendor,
      allKnownVendors: allVendors,
      isFallbackReader: isFallback
    });

    // 5. Evaluate deterministic decision table
    const decision = evaluateDecisionTable(aiAnalysis.paymentRequested, flags);

    // 6. Generate callback recommendation (phone strictly from vendor record)
    const callbackRec = generateCallbackRecommendation({
      vendor: matchedVendor,
      verdict: decision.verdict,
      flags,
      amount: aiAnalysis.amount,
      currency: aiAnalysis.currency,
      newPayeeRequested: aiAnalysis.payeeChangeRequested || flags.some(f => f.id === 'payee_change'),
      emailPhones: aiAnalysis.phonesInEmail
    });

    // 7. Create payment proposal if payment is requested
    let proposal: PaymentProposal | null = null;
    if (aiAnalysis.paymentRequested) {
      const amount = aiAnalysis.amount || (matchedVendor ? matchedVendor.typicalAmount : 0);
      const currency = aiAnalysis.currency || 'USD';

      // CRITICAL SECURITY RULE:
      // Payee is strictly taken from vendor record on file. NEVER the attacker's requested new payee!
      let payeeAddress: string;
      if (matchedVendor && matchedVendor.paypalEmails.length > 0) {
        payeeAddress = matchedVendor.paypalEmails[0];
      } else {
        // Unknown vendor fallback to sender's own email address
        payeeAddress = parsedEmail.senderAddress || 'unregistered@vendor.com';
      }

      const requestedPayee =
        aiAnalysis.newPayeeIdentifiers.length > 0
          ? aiAnalysis.newPayeeIdentifiers[0]
          : null;

      const policyConstraints = evaluatePolicy(amount, decision.verdict, policyConfig);

      const now = new Date().toISOString();
      proposal = {
        id: 'prop_' + crypto.randomUUID().slice(0, 12),
        vendorId: matchedVendor ? matchedVendor.id : null,
        vendorName: matchedVendor ? matchedVendor.name : (aiAnalysis.vendorName || 'Unknown Vendor'),
        amount,
        currency,
        payee: payeeAddress,
        requestedPayeeInEmail: requestedPayee,
        verdict: decision.verdict,
        flags,
        status: policyConstraints.isHardBlocked ? 'BLOCKED' : 'PENDING_REVIEW',
        requiresCallbackCheck: policyConstraints.requiresCallbackCheck,
        requiresAmountConfirm: policyConstraints.requiresAmountConfirm,
        isHardBlocked: policyConstraints.isHardBlocked,
        callbackConfirmed: false,
        callbackNote: null,
        approvalNote: null,
        rejectionReason: policyConstraints.blockReason || null,
        paypalBatchId: null,
        paypalPayoutItemId: null,
        rawEmail,
        createdAt: now,
        updatedAt: now
      };

      this.repository.saveProposal(proposal);
    }

    // 8. Add Audit Log
    this.repository.addAuditLog({
      action: 'EMAIL_CHECKED',
      actor,
      targetId: proposal ? proposal.id : null,
      details: {
        sender: parsedEmail.senderAddress,
        domain: parsedEmail.senderDomain,
        subject: parsedEmail.subject,
        verdict: decision.verdict,
        flagsCount: flags.length,
        flags: flags.map(f => f.id),
        proposalId: proposal?.id || null,
        isFallbackReader: isFallback
      }
    });

    return {
      parsedEmail,
      aiAnalysis,
      secondOpinion,
      backstop,
      matchedVendor,
      flags,
      verdict: decision.verdict,
      verdictSummary: decision.reason,
      callbackRecommendation: callbackRec,
      proposal,
      isFallbackReader: isFallback
    };
  }
}
