import {
  Flag,
  ParsedEmail,
  EmailAIAnalysis,
  SecondOpinion,
  BackstopSignals,
  Vendor,
  RuleId,
  AttachmentAnalysisResult,
  BlockedSender,
  BlockedPayee
} from './types.js';
import { checkLookalikeDomain } from './lookalike.js';

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'icloud.com',
  'mail.com',
  'zoho.com',
  'yandex.com'
]);

export interface EvaluationInput {
  parsedEmail: ParsedEmail;
  aiAnalysis: EmailAIAnalysis;
  secondOpinion: SecondOpinion | null;
  backstop: BackstopSignals;
  matchedVendor: Vendor | null;
  allKnownVendors: Vendor[];
  isFallbackReader: boolean;
  attachmentAnalyses?: AttachmentAnalysisResult[];
  blockedSenders?: BlockedSender[];
  blockedPayees?: BlockedPayee[];
}

/**
 * Runs the deterministic 16-rule checklist on the input data.
 * Every returned flag includes its ID, severity, title, and concrete evidence.
 */
export function evaluateRules(input: EvaluationInput): Flag[] {
  const {
    parsedEmail,
    aiAnalysis,
    secondOpinion,
    backstop,
    matchedVendor,
    allKnownVendors,
    isFallbackReader,
    blockedSenders = [],
    blockedPayees = []
  } = input;

  const flags: Flag[] = [];

  const paymentRequested = aiAnalysis.paymentRequested;

  // 1. bank_change / payee_change: HIGH
  // Triggers if AI detected payeeChangeRequested, or backstop found payment change phrases/new accounts
  const payeeChangeSignals: string[] = [];
  if (aiAnalysis.payeeChangeRequested) {
    payeeChangeSignals.push('AI detected explicit request to change payee/banking destination');
  }
  if (backstop.paymentChangePhrases.length > 0) {
    payeeChangeSignals.push(`Backstop phrase match: ${backstop.paymentChangePhrases.join(', ')}`);
  }
  if (backstop.ibanFound.length > 0) {
    payeeChangeSignals.push(`Unregistered IBAN present: ${backstop.ibanFound.join(', ')}`);
  }
  if (backstop.accountNumbersFound.length > 0) {
    payeeChangeSignals.push(`Unregistered bank account number present: ${backstop.accountNumbersFound.join(', ')}`);
  }
  if (backstop.remitToBlock && payeeChangeSignals.length > 0) {
    payeeChangeSignals.push(`Remit-to instructions found in email body`);
  }

  if (payeeChangeSignals.length > 0 && paymentRequested) {
    flags.push({
      id: 'payee_change',
      severity: 'HIGH',
      title: 'Payee or Bank Account Change Requested',
      evidence: payeeChangeSignals.join('; ')
    });
  }

  // 2. payee_change_notice: MEDIUM
  // Triggers if announced future change, but not an immediate redirection for this payment
  if (
    (aiAnalysis.payeeChangeMentioned || (backstop.paymentChangePhrases.length > 0 && !aiAnalysis.payeeChangeRequested)) &&
    !flags.some(f => f.id === 'payee_change')
  ) {
    flags.push({
      id: 'payee_change_notice',
      severity: 'MEDIUM',
      title: 'Advance Notice of Payee/Banking Change',
      evidence: 'Email mentions a pending or upcoming update to banking/payment details.'
    });
  }

  // 3. lookalike_domain: HIGH
  // Compare incoming sender domain against all vendor domains on file
  const allKnownDomains = allKnownVendors.flatMap(v => v.domains);
  const lookalike = checkLookalikeDomain(parsedEmail.senderDomain, allKnownDomains);
  if (lookalike.isLookalike) {
    flags.push({
      id: 'lookalike_domain',
      severity: 'HIGH',
      title: 'Lookalike / Spoofed Domain Detected',
      evidence: `Sender domain '${parsedEmail.senderDomain}' mimics trusted domain '${lookalike.trustedDomain}'. ${lookalike.reason}`
    });
  }

  // 4. reply_to_mismatch: HIGH if payment requested, else MEDIUM
  if (parsedEmail.replyToDomain && parsedEmail.senderDomain) {
    const sDomain = parsedEmail.senderDomain.toLowerCase();
    const rDomain = parsedEmail.replyToDomain.toLowerCase();
    if (sDomain !== rDomain && !rDomain.endsWith('.' + sDomain)) {
      flags.push({
        id: 'reply_to_mismatch',
        severity: paymentRequested ? 'HIGH' : 'MEDIUM',
        title: 'Reply-To Header Address Mismatch',
        evidence: `From domain '${sDomain}' routes replies to different domain '${rDomain}'`
      });
    }
  }

  // 5. gift_cards / crypto: HIGH
  if (aiAnalysis.giftCards || backstop.cryptoOrGiftCards) {
    flags.push({
      id: 'gift_cards',
      severity: 'HIGH',
      title: 'Gift Card or Cryptocurrency Payment Requested',
      evidence: 'Payment requested in non-standard untraceable currency (gift cards, Bitcoin, USDT, etc.)'
    });
  }

  // 6. auth_fail (SPF / DKIM / DMARC failure in headers): HIGH
  if (parsedEmail.headers.authResults) {
    const authText = parsedEmail.headers.authResults.toLowerCase();
    const hasSpfFail = /spf=(?:fail|softfail)/.test(authText);
    const hasDkimFail = /dkim=fail/.test(authText);
    const hasDmarcFail = /dmarc=fail/.test(authText);
    if (hasSpfFail || hasDkimFail || hasDmarcFail) {
      const fails: string[] = [];
      if (hasSpfFail) fails.push('SPF failed');
      if (hasDkimFail) fails.push('DKIM failed');
      if (hasDmarcFail) fails.push('DMARC failed');
      flags.push({
        id: 'auth_fail',
        severity: 'HIGH',
        title: 'Email Authentication Verification Failed',
        evidence: `Header Authentication-Results reported: ${fails.join(', ')}`
      });
    }
  }

  // 7. unknown_vendor: MEDIUM
  if (!matchedVendor && paymentRequested) {
    flags.push({
      id: 'unknown_vendor',
      severity: 'MEDIUM',
      title: 'Unknown Vendor / First-Time Requester',
      evidence: `Sender domain '${parsedEmail.senderDomain}' does not match any existing vendor record in the database.`
    });
  }

  // 8. sender_not_on_file: MEDIUM
  if (matchedVendor && parsedEmail.senderDomain) {
    const onFile = matchedVendor.domains.some(
      d => d.toLowerCase() === parsedEmail.senderDomain.toLowerCase()
    );
    if (!onFile) {
      flags.push({
        id: 'sender_not_on_file',
        severity: 'MEDIUM',
        title: 'Sender Domain Not on File for Matched Vendor',
        evidence: `Sender domain '${parsedEmail.senderDomain}' is not registered under vendor '${matchedVendor.name}'. Registered domains: ${matchedVendor.domains.join(', ')}`
      });
    }
  }

  // 9. new_payee_identifier: HIGH
  // If email specifies a PayPal address that does NOT match the vendor's registered PayPal email
  if (matchedVendor && paymentRequested) {
    const registeredPaypals = matchedVendor.paypalEmails.map(e => e.toLowerCase());
    const candidates = [
      ...aiAnalysis.newPayeeIdentifiers.map(i => i.toLowerCase()),
      ...backstop.paypalEmailsFound
    ];

    const sender = parsedEmail.senderAddress.toLowerCase();
    const recipient = (parsedEmail.headers.to || '').toLowerCase();

    const unlistedPaypal = candidates.find(c => {
      const email = c.toLowerCase().trim();
      if (!email.includes('@')) return false;
      if (registeredPaypals.includes(email)) return false;
      if (email === sender) return false;
      // Exclude recipient addresses (e.g. accounting@mybusiness.com)
      if (recipient.includes(email)) return false;
      return true;
    });

    if (unlistedPaypal) {
      flags.push({
        id: 'new_payee_identifier',
        severity: 'HIGH',
        title: 'Unrecognized Payee Account in Email',
        evidence: `Email requests payment to '${unlistedPaypal}', but vendor '${matchedVendor.name}' is registered with payee: ${registeredPaypals.join(', ')}`
      });
    }
  }

  // 10. free_mail_payment: MEDIUM
  if (FREE_MAIL_DOMAINS.has(parsedEmail.senderDomain.toLowerCase()) && paymentRequested) {
    flags.push({
      id: 'free_mail_payment',
      severity: 'MEDIUM',
      title: 'Free Webmail Provider Used for Commercial Invoice',
      evidence: `Sender uses free consumer email provider '${parsedEmail.senderDomain}' rather than a corporate domain.`
    });
  }

  // 11. subdomain_sender: MEDIUM
  // More than 2 dots in domain (e.g., mail.ops.billing.vendor.com)
  const parts = parsedEmail.senderDomain.split('.');
  if (parts.length > 3 && !parts.slice(-2).join('.').includes('co.')) {
    flags.push({
      id: 'subdomain_sender',
      severity: 'MEDIUM',
      title: 'Unusual Multi-level Subdomain',
      evidence: `Sender domain '${parsedEmail.senderDomain}' has nested subdomains that may disguise the true host.`
    });
  }

  // 12. amount_anomaly: MEDIUM (more than 3x the vendor's typical amount)
  if (matchedVendor && aiAnalysis.amount && matchedVendor.typicalAmount > 0) {
    if (aiAnalysis.amount > 3 * matchedVendor.typicalAmount) {
      flags.push({
        id: 'amount_anomaly',
        severity: 'MEDIUM',
        title: 'Amount Anomaly (>3x Vendor Typical Payout)',
        evidence: `Requested amount $${aiAnalysis.amount.toFixed(2)} exceeds 3x vendor median typical amount ($${matchedVendor.typicalAmount.toFixed(2)}).`
      });
    }
  }

  // 13. pressure tactics: MEDIUM
  const activeTactics: string[] = [];
  if (aiAnalysis.tactics.urgency) activeTactics.push('Urgency (deadline / immediate payment required)');
  if (aiAnalysis.tactics.secrecy) activeTactics.push('Secrecy (confidential / do not discuss)');
  if (aiAnalysis.tactics.authority) activeTactics.push('Executive Authority (CEO / Board directive)');
  if (aiAnalysis.tactics.avoid_phone) activeTactics.push('Phone Avoidance (in a meeting / phone broken)');

  if (activeTactics.length > 0 && paymentRequested) {
    flags.push({
      id: 'pressure',
      severity: 'MEDIUM',
      title: 'Social Engineering Pressure Tactics Detected',
      evidence: activeTactics.join('; ')
    });
  }

  // 14. channel_shift: MEDIUM
  if (aiAnalysis.channelShift) {
    flags.push({
      id: 'channel_shift',
      severity: 'MEDIUM',
      title: 'Channel Shift Request',
      evidence: 'Requester asks to continue communications over alternative channels (WhatsApp, Telegram, SMS, personal phone).'
    });
  }

  // 15. model_judgement: independent second opinion (can add flag, never remove)
  if (secondOpinion) {
    if (secondOpinion.verdict === 'HOLD') {
      flags.push({
        id: 'model_judgement',
        severity: 'HIGH',
        title: 'AI Second Opinion Flagged Suspicious',
        evidence: `Independent judge returned HOLD: ${secondOpinion.reason}`
      });
    } else if (secondOpinion.verdict === 'CHECK') {
      flags.push({
        id: 'model_judgement',
        severity: 'MEDIUM',
        title: 'AI Second Opinion Suggested Verification',
        evidence: `Independent judge returned CHECK: ${secondOpinion.reason}`
      });
    }
  }

  // 16. no_ai_reader: LOW/MEDIUM
  // Fallback reader must never return bare CLEAR for an email asking for money
  if (isFallbackReader && paymentRequested) {
    flags.push({
      id: 'no_ai_reader',
      severity: 'MEDIUM',
      title: 'Cautious Fallback Mode (No AI Key)',
      evidence: 'No GEMINI_API_KEY detected. Fallback deterministic reader mandates verification check for payment requests.'
    });
  }

  // --- ATTACHMENT RULES (17 - 21) ---
  const attachmentAnalyses = input.attachmentAnalyses || [];

  for (const att of attachmentAnalyses) {
    // 17. attachment_not_read: MEDIUM
    if (att.error || !att.invoiceData || att.invoiceData.unreadable) {
      flags.push({
        id: 'attachment_not_read',
        severity: 'MEDIUM',
        title: 'Invoice Attachment Could Not Be Read',
        evidence: `Attachment '${att.attachment.filename}' could not be analyzed (${att.error || 'unreadable content or fallback mode without recorded sample'}). Human review required.`
      });
    }

    if (att.invoiceData && !att.invoiceData.unreadable) {
      const inv = att.invoiceData;

      // 18. attachment_hidden_instructions: HIGH
      if (inv.hiddenInstructionsDetected) {
        flags.push({
          id: 'attachment_hidden_instructions',
          severity: 'HIGH',
          title: 'Hidden Instructions / Prompt Injection in Attachment',
          evidence: `Document '${att.attachment.filename}' contains suspicious prompt instructions or attempts to alter agent behavior.`
        });
      }

      // Check payee identifiers in attachment
      const registeredPaypals = matchedVendor ? matchedVendor.paypalEmails.map(e => e.toLowerCase()) : [];
      const emailPayees = [
        ...aiAnalysis.newPayeeIdentifiers.map(i => i.toLowerCase()),
        parsedEmail.senderAddress.toLowerCase()
      ];

      const invPayees = inv.payeeIdentifiers.map(p => p.trim());

      // 19. attachment_payee_mismatch: HIGH
      // Payee in PDF differs from email's payee or from vendor's payee on file
      const conflictingPayees = invPayees.filter(payee => {
        const clean = payee.toLowerCase();
        // If matched vendor has payees on file, does PDF payee match any of them?
        if (matchedVendor && registeredPaypals.length > 0) {
          if (!registeredPaypals.includes(clean)) return true;
        }
        // If email requested a specific payee and it's different from PDF payee
        if (aiAnalysis.newPayeeIdentifiers.length > 0 && !emailPayees.includes(clean)) {
          return true;
        }
        return false;
      });

      if (conflictingPayees.length > 0) {
        flags.push({
          id: 'attachment_payee_mismatch',
          severity: 'HIGH',
          title: 'Attachment Payee Mismatches Vendor Records / Email Claims',
          evidence: `Attachment '${att.attachment.filename}' lists payee(s): ${conflictingPayees.join(', ')}, which does not match verified payee on file (${registeredPaypals.join(', ') || 'none on file'}) or email claims.`
        });
      }

      // 20. attachment_new_payee: HIGH
      // If attachment introduces an unrecognized payee not registered on file
      const unknownPayees = invPayees.filter(payee => {
        const clean = payee.toLowerCase();
        return !registeredPaypals.includes(clean);
      });

      if (unknownPayees.length > 0 && !flags.some(f => f.id === 'attachment_new_payee')) {
        flags.push({
          id: 'attachment_new_payee',
          severity: 'HIGH',
          title: 'Unrecognized Payee Identifier in Attachment',
          evidence: `Attachment '${att.attachment.filename}' introduces unverified payee destination: ${unknownPayees.join(', ')}.`
        });
      }

      // 21. attachment_amount_mismatch: MEDIUM, HIGH if above 2x difference
      if (inv.amount != null && aiAnalysis.amount != null) {
        const diff = Math.abs(inv.amount - aiAnalysis.amount);
        if (diff > 0.01) {
          const ratio = Math.max(inv.amount, aiAnalysis.amount) / Math.max(0.01, Math.min(inv.amount, aiAnalysis.amount));
          const isHighMismatch = ratio >= 2.0;

          flags.push({
            id: 'attachment_amount_mismatch',
            severity: isHighMismatch ? 'HIGH' : 'MEDIUM',
            title: isHighMismatch
              ? 'Severe Amount Mismatch Between Attachment and Email (>= 2x)'
              : 'Amount Discrepancy Between Attachment and Email',
            evidence: `Attachment invoice lists $${inv.amount.toFixed(2)} ${inv.currency || 'USD'}, but email claims $${aiAnalysis.amount.toFixed(2)} ${aiAnalysis.currency || 'USD'} (${ratio.toFixed(1)}x difference).`
          });
        }
      }
    }
  }

  // 22. blocklisted_sender: HIGH (forces HOLD)
  const senderDomainLower = parsedEmail.senderDomain.toLowerCase();
  const senderAddressLower = parsedEmail.senderAddress.toLowerCase();
  const replyToDomainLower = parsedEmail.replyToDomain?.toLowerCase();
  const replyToAddressLower = parsedEmail.replyToAddress?.toLowerCase();

  const matchedBlockedSender = blockedSenders.find(s => {
    if (s.domain && (s.domain.toLowerCase() === senderDomainLower || (replyToDomainLower && s.domain.toLowerCase() === replyToDomainLower))) {
      return true;
    }
    if (s.address && (s.address.toLowerCase() === senderAddressLower || (replyToAddressLower && s.address.toLowerCase() === replyToAddressLower))) {
      return true;
    }
    return false;
  });

  if (matchedBlockedSender) {
    flags.push({
      id: 'blocklisted_sender',
      severity: 'HIGH',
      title: 'Sender is on Security Blocklist',
      evidence: `Sender address '${parsedEmail.senderAddress}' or domain '${parsedEmail.senderDomain}' was previously blocklisted for security reasons (Reason: ${matchedBlockedSender.reason}).`
    });
  }

  // 23. blocklisted_payee: HIGH (forces HOLD)
  const candidatePayees = new Set<string>();
  for (const p of aiAnalysis.newPayeeIdentifiers) candidatePayees.add(p.toLowerCase());
  for (const p of backstop.paypalEmailsFound) candidatePayees.add(p.toLowerCase());
  for (const p of backstop.ibanFound) candidatePayees.add(p.toLowerCase());
  for (const p of backstop.accountNumbersFound) candidatePayees.add(p.toLowerCase());
  if (attachmentAnalyses) {
    for (const att of attachmentAnalyses) {
      if (att.invoiceData?.payeeIdentifiers) {
        for (const p of att.invoiceData.payeeIdentifiers) candidatePayees.add(p.toLowerCase());
      }
    }
  }

  const matchedBlockedPayee = blockedPayees.find(bp =>
    candidatePayees.has(bp.identifier.toLowerCase())
  );

  if (matchedBlockedPayee) {
    flags.push({
      id: 'blocklisted_payee',
      severity: 'HIGH',
      title: 'Payee Identifier is on Security Blocklist',
      evidence: `Requested payee '${matchedBlockedPayee.identifier}' was previously blocklisted as an attacker or unauthorized account (Reason: ${matchedBlockedPayee.reason}).`
    });
  }

  return flags;
}
