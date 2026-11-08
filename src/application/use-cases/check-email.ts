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
import { IInvoiceReader } from '../ports/invoice-reader.js';
import { RecordedReader } from '../../adapters/ai/recorded-reader.js';
import { FallbackInvoiceReader } from '../../adapters/ai/fallback-invoice-reader.js';
import {
  CheckEmailResult,
  PaymentProposal,
  InvoiceAttachment,
  AttachmentAnalysisResult,
  InvoiceData
} from '../../domain/types.js';

export interface CheckEmailOptions {
  rawEmail: string;
  attachments?: InvoiceAttachment[];
  actor?: string;
  source?: 'manual' | 'zapier_intake' | 'mcp';
  policyConfig: {
    approvalLimit: number;
    hardLimit: number;
    dualApprovalThreshold?: number;
    coolingOffHours?: number;
  };
}

export class CheckEmailUseCase {
  private repository: IRepository;
  private emailReader: IEmailReader;
  private secondOpinionJudge: ISecondOpinionJudge | null;
  private invoiceReader: IInvoiceReader;
  private recordedReader: RecordedReader;

  constructor(
    repository: IRepository,
    emailReader: IEmailReader,
    secondOpinionJudge: ISecondOpinionJudge | null = null,
    invoiceReader: IInvoiceReader | null = null
  ) {
    this.repository = repository;
    this.emailReader = emailReader;
    this.secondOpinionJudge = secondOpinionJudge;
    this.invoiceReader = invoiceReader || new FallbackInvoiceReader();
    this.recordedReader = new RecordedReader();
  }

  async execute(options: CheckEmailOptions): Promise<CheckEmailResult> {
    const { rawEmail, attachments = [], actor = 'approver', policyConfig } = options;

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

    // 3. Process attachments (up to 3) if provided
    const attachmentAnalyses: AttachmentAnalysisResult[] = [];
    if (attachments && attachments.length > 0) {
      for (const att of attachments.slice(0, 3)) {
        try {
          // Check if this attachment matches a recorded sample reading
          let invoiceData: InvoiceData | null = null;
          if (sampleMatch && (sampleMatch as any).attachments) {
            const recordedAtt = (sampleMatch as any).attachments.find(
              (a: any) =>
                a.filename.toLowerCase() === att.filename.toLowerCase() ||
                (att.contentBase64 && a.contentBase64 && a.contentBase64 === att.contentBase64)
            );
            if (recordedAtt && recordedAtt.recordedInvoiceData) {
              invoiceData = recordedAtt.recordedInvoiceData;
            }
          }

          if (!invoiceData) {
            invoiceData = await this.invoiceReader.readInvoice(att);
          }

          attachmentAnalyses.push({
            attachment: {
              filename: att.filename,
              mimeType: att.mimeType,
              sizeBytes: att.sizeBytes || Math.round(att.contentBase64.length * 0.75)
            },
            invoiceData
          });

          // Run deterministic backstop over text extracted from attachment too
          if (invoiceData?.rawExtractedText) {
            const attachBackstop = scanBackstop(invoiceData.rawExtractedText);
            backstop.ibanFound = Array.from(new Set([...backstop.ibanFound, ...attachBackstop.ibanFound]));
            backstop.accountNumbersFound = Array.from(
              new Set([...backstop.accountNumbersFound, ...attachBackstop.accountNumbersFound])
            );
            backstop.paymentChangePhrases = Array.from(
              new Set([...backstop.paymentChangePhrases, ...attachBackstop.paymentChangePhrases])
            );
            backstop.paypalEmailsFound = Array.from(
              new Set([...backstop.paypalEmailsFound, ...attachBackstop.paypalEmailsFound])
            );
            if (attachBackstop.cryptoOrGiftCards) {
              backstop.cryptoOrGiftCards = true;
            }
            if (attachBackstop.remitToBlock && !backstop.remitToBlock) {
              backstop.remitToBlock = attachBackstop.remitToBlock;
            }
          }
        } catch (err: any) {
          attachmentAnalyses.push({
            attachment: {
              filename: att.filename,
              mimeType: att.mimeType,
              sizeBytes: att.sizeBytes || 0
            },
            invoiceData: null,
            error: err.message
          });
        }
      }
    }

    // 4. Find matched vendor in repository & fetch security blocklists
    const allVendors = this.repository.getAllVendors();
    const matchedVendor = this.repository.findVendorByDomainOrName(
      parsedEmail.senderDomain,
      aiAnalysis.vendorName || parsedEmail.senderName
    );
    const blockedSenders = this.repository.getBlockedSenders();
    const blockedPayees = this.repository.getBlockedPayees();

    // 5. Evaluate security rules (including attachment rules & blocklists)
    const flags = evaluateRules({
      parsedEmail,
      aiAnalysis,
      secondOpinion,
      backstop,
      matchedVendor,
      allKnownVendors: allVendors,
      isFallbackReader: isFallback,
      attachmentAnalyses,
      blockedSenders,
      blockedPayees
    });

    // 6. Evaluate deterministic decision table
    const paymentRequested =
      aiAnalysis.paymentRequested ||
      attachmentAnalyses.some(a => (a.invoiceData?.amount ?? 0) > 0);
    const decision = evaluateDecisionTable(paymentRequested, flags);

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

      const paymentRecords = this.repository.getPaymentRecords();
      const hasPaymentRecord = paymentRecords.some(
        p => p.payeeEmail.toLowerCase() === payeeAddress.toLowerCase() && p.status === 'SUCCESS'
      );
      const hasVendorHistory = Boolean(
        matchedVendor &&
        matchedVendor.paymentCount > 0 &&
        matchedVendor.paypalEmails.some(email => email.toLowerCase() === payeeAddress.toLowerCase())
      );
      const hasPriorPayment = hasPaymentRecord || hasVendorHistory;
      const dualThreshold = (policyConfig as any).dualApprovalThreshold ?? 1000;
      const requiresDualApproval = amount >= dualThreshold || !hasPriorPayment;

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
        updatedAt: now,
        requiresDualApproval,
        firstApprover: null,
        firstApprovedAt: null,
        secondApprover: null,
        secondApprovedAt: null,
        coolingOffUntil: null,
        coolingOffBypassed: false,
        source: options.source || 'manual'
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
        isFallbackReader: isFallback,
        attachmentsCount: attachmentAnalyses.length,
        attachmentFilenames: attachmentAnalyses.map(a => a.attachment.filename)
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
      isFallbackReader: isFallback,
      attachments: attachmentAnalyses
    };
  }
}
