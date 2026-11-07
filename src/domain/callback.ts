import { CallbackRecommendation, Vendor, Verdict, Flag } from './types.js';

export interface CallbackGeneratorInput {
  vendor: Vendor | null;
  verdict: Verdict;
  flags: Flag[];
  amount: number | null;
  currency?: string | null;
  newPayeeRequested: boolean;
  /**
   * Phone numbers found in the email body are explicitly passed
   * so the callback generator can guarantee they are NEVER used.
   */
  emailPhones?: string[];
}

/**
 * Generates an out-of-band callback verification script for small business operators.
 *
 * HARD SECURITY INVARIANT:
 * The contact phone number comes ONLY from trusted vendor records on file,
 * NEVER from the email body or headers. If no trusted number is on file,
 * the script explicitly warns the user and demands looking up the number in contracts.
 */
export function generateCallbackRecommendation(
  input: CallbackGeneratorInput
): CallbackRecommendation {
  const { vendor, amount, currency = 'USD', newPayeeRequested } = input;
  const vendorName = vendor ? vendor.name : 'Unknown Vendor';
  const phoneOnFile = vendor?.phone ? vendor.phone.trim() : null;

  const questions: string[] = [];
  const curr = currency || 'USD';
  const formattedAmt = amount !== null ? `$${amount.toFixed(2)} ${curr}` : 'the requested sum';

  questions.push(`"Did your accounts department send an invoice/payment request for ${formattedAmt}?"`);

  if (newPayeeRequested) {
    questions.push(
      `"Our records show your regular payee account, but this email requested payment to a new destination. Did you officially change your payment details?"`
    );
    questions.push(
      `"Can you confirm your accounts receivable contact or official banking authorization code?"`
    );
  } else {
    questions.push(`"Can you confirm the invoice or project reference number for this payment?"`);
  }

  if (phoneOnFile) {
    const script = [
      `📞 OUT-OF-BAND PHONE VERIFICATION SCRIPT`,
      `-----------------------------------------`,
      `Target: ${vendorName}`,
      `Trusted Phone on File: ${phoneOnFile} (Verified internal record — NEVER use numbers from the email)`,
      ``,
      `Instructions for Bookkeeper / Approver:`,
      `1. Call ${phoneOnFile} directly. Do NOT rely on caller ID or numbers in email signatures.`,
      `2. Ask the contact:`,
      ...questions.map(q => `   - ${q}`),
      `3. Verify that the person answering is authorized to confirm banking/treasury instructions.`
    ].join('\n');

    return {
      vendorName,
      phoneNumber: phoneOnFile,
      hasPhoneOnFile: true,
      suggestedQuestions: questions,
      script
    };
  }

  // No phone on file case
  const warningScript = [
    `⚠️ NO TRUSTED PHONE NUMBER ON FILE`,
    `-----------------------------------------`,
    `Vendor: ${vendorName}`,
    `Internal Record: No verified phone number found in your vendor registry.`,
    ``,
    `CRITICAL SECURITY RULE:`,
    `- DO NOT call any phone numbers listed inside the incoming email body or signature.`,
    `- DO NOT click any links or use contact methods from the email.`,
    `- Locate the vendor's telephone number independently in your original written contract, incorporation records, or corporate purchase order before releasing funds.`
  ].join('\n');

  return {
    vendorName,
    phoneNumber: null,
    hasPhoneOnFile: false,
    suggestedQuestions: questions,
    script: warningScript
  };
}
