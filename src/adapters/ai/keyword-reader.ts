import { IEmailReader } from '../../application/ports/email-reader.js';
import { ParsedEmail, EmailAIAnalysis } from '../../domain/types.js';

export class KeywordReader implements IEmailReader {
  public readonly isFallback = true;

  async readEmail(parsedEmail: ParsedEmail): Promise<EmailAIAnalysis> {
    const text = `${parsedEmail.subject}\n${parsedEmail.body}`.toLowerCase();

    // 1. Payment Requested Detection
    const paymentKeywords = [
      'invoice', 'payment', 'pay ', 'please pay', 'remit', 'remittance',
      'balance due', 'amount due', 'total due', 'wire transfer', 'settle account',
      'billing statement', 'due date', 'overdue', 'factura', 'rechnung', 'pago'
    ];
    const hasCurrencySymbols = /[\$€£]\s*[0-9]+|[0-9]+\s*(?:usd|eur|gbp)/i.test(text);
    const paymentRequested = paymentKeywords.some(kw => text.includes(kw)) || hasCurrencySymbols;

    // 2. Payee / Banking Change Detection
    const changeKeywords = [
      'changed our bank', 'new bank account', 'new bank details', 'updated payment details',
      'new paypal', 'new payee', 'cambio de cuenta', 'nouveau compte', 'neue bankverbindung',
      'alteração dos dados', 'direct all future payments to', 'temporary account'
    ];
    const payeeChangeRequested = changeKeywords.some(kw => text.includes(kw));
    const payeeChangeMentioned = payeeChangeRequested || text.includes('future banking update') || text.includes('upcoming change');

    // 3. Amount and Currency Extraction
    let amount: number | null = null;
    let currency: string | null = null;

    const amountMatch = text.match(/(?:[\$]|usd\s*|eur\s*|€\s*|gbp\s*|£\s*)([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i) ||
                        text.match(/([0-9]+(?:\.[0-9]{2})?)\s*(?:usd|eur|dollars|euros)/i);

    if (amountMatch) {
      const rawNum = amountMatch[1].replace(/,/g, '');
      const parsedNum = parseFloat(rawNum);
      if (!isNaN(parsedNum)) {
        amount = parsedNum;
      }
    }

    if (text.includes('€') || text.includes('eur')) currency = 'EUR';
    else if (text.includes('£') || text.includes('gbp')) currency = 'GBP';
    else if (text.includes('$') || text.includes('usd') || amount !== null) currency = 'USD';

    // 4. Tactics (Urgency, Secrecy, Authority, Phone Avoidance)
    const urgency = /\b(?:urgent|asap|immediately|today|right away|by end of day|within 24 hours)\b/i.test(text);
    const secrecy = /\b(?:confidential|strictly private|do not discuss|keep this between us|discrete)\b/i.test(text);
    const authority = /\b(?:ceo|cfo|executive|board of directors|president directive|authorized by)\b/i.test(text);
    const avoid_phone = /\b(?:in a meeting|in a conference|phone broken|cannot take calls|do not call|voice message only)\b/i.test(text);

    // 5. Channel Shift
    const channelShift = /\b(?:whatsapp|telegram|signal|personal cell|text me at)\b/i.test(text);

    // 6. Gift Cards / Crypto
    const giftCards = /\b(?:gift\s*cards?|itunes|steam\s*card|apple\s*gift|bitcoin|btc|usdt|crypto)\b/i.test(text);

    // 7. Extract email addresses and phones in body
    const emailMatches = parsedEmail.body.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g) || [];
    const phoneMatches = parsedEmail.body.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];

    // Candidate payee identifiers (emails in body other than sender)
    const newPayeeIdentifiers = Array.from(
      new Set(
        emailMatches
          .map(e => e.toLowerCase())
          .filter(e => e !== parsedEmail.senderAddress.toLowerCase())
      )
    );

    const vendorName = parsedEmail.senderName ||
      (parsedEmail.senderDomain ? parsedEmail.senderDomain.split('.')[0] : 'Unknown');

    return {
      vendorName,
      paymentRequested,
      payeeChangeRequested,
      payeeChangeMentioned,
      newPayeeIdentifiers,
      amount,
      currency: currency || (paymentRequested ? 'USD' : null),
      tactics: {
        urgency,
        secrecy,
        authority,
        avoid_phone
      },
      channelShift,
      giftCards,
      phonesInEmail: Array.from(new Set(phoneMatches))
    };
  }
}
