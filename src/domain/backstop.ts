import { BackstopSignals } from './types.js';

// International Bank Account Number regex (2 letters + 2 digits + up to 30 alphanumeric)
const IBAN_REGEX = /\b([A-Z]{2}[0-9]{2}[A-Z0-9]{4,30})\b/g;

// Bank routing and account number patterns
const ACCOUNT_PATTERNS = [
  /(?:account\s*(?:number|no|#)|routing\s*(?:number|no|#)|sort\s*code|swift|bic|clabe)[\s:]+([A-Za-z0-9\-]{5,26})/gi,
  /(?:bank\s*account)[\s:]+([A-Za-z0-9\-]{5,26})/gi
];

// Multilingual phrases announcing changed payment details
const PAYMENT_CHANGE_PATTERNS: { regex: RegExp; lang: string }[] = [
  // English
  { regex: /change(?:d)?\s+(?:our\s+)?(?:bank|payment|banking|remittance)\s+(?:details|information|info|account|instructions)/i, lang: 'EN' },
  { regex: /new\s+(?:bank|paypal|payment|banking)\s+(?:account|details|info|address|coordinates)/i, lang: 'EN' },
  { regex: /update(?:d)?\s+(?:our\s+)?(?:bank|payment|banking)\s+(?:details|information|info|account)/i, lang: 'EN' },
  { regex: /pay\s+(?:to\s+)?(?:our\s+)?new\s+(?:account|details|address)/i, lang: 'EN' },
  { regex: /direct\s+(?:all\s+)?(?:future\s+)?payments?\s+to/i, lang: 'EN' },
  { regex: /do\s+not\s+(?:use|send\s+to)\s+the\s+old\s+account/i, lang: 'EN' },
  { regex: /bank\s+is\s+under\s+audit/i, lang: 'EN' },
  { regex: /temporary\s+(?:payment\s+)?(?:account|address)/i, lang: 'EN' },

  // Spanish
  { regex: /cambio\s+de\s+(?:datos\s+bancarios|cuenta\s+bancaria|detalles\s+de\s+pago)/i, lang: 'ES' },
  { regex: /nueva\s+cuenta\s+(?:bancaria|de\s+pago)/i, lang: 'ES' },
  { regex: /cambiamos\s+nuestra\s+cuenta/i, lang: 'ES' },
  { regex: /actualiza(?:mos|ción)\s+(?:de\s+)?nuestros\s+datos\s+de\s+pago/i, lang: 'ES' },

  // French
  { regex: /changement\s+de\s+(?:coordonn[ée]es\s+bancaires|rib|compte\s+bancaire)/i, lang: 'FR' },
  { regex: /nouveau\s+(?:rib|compte\s+bancaire|compte\s+de\s+paiement)/i, lang: 'FR' },
  { regex: /nouvelles\s+coordonn[ée]es\s+bancaires/i, lang: 'FR' },
  { regex: /modification\s+de\s+nos\s+coordonn[ée]es/i, lang: 'FR' },

  // German
  { regex: /neue\s+bankverbindung/i, lang: 'DE' },
  { regex: /ge[äa]nderte\s+bankdaten/i, lang: 'DE' },
  { regex: /[äa]nderung\s+unserer\s+bankverbindung/i, lang: 'DE' },
  { regex: /unsere\s+neue\s+kontonummer/i, lang: 'DE' },

  // Portuguese
  { regex: /mudan[çc]a\s+de\s+dados\s+banc[áa]rios/i, lang: 'PT' },
  { regex: /nova\s+conta\s+banc[áa]ria/i, lang: 'PT' },
  { regex: /novos\s+dados\s+para\s+pagamento/i, lang: 'PT' },
  { regex: /altera[çc][ãa]o\s+dos\s+dados\s+banc[áa]rios/i, lang: 'PT' }
];

// Crypto and Gift Card patterns
const CRYPTO_GIFT_PATTERNS = [
  /\b(?:gift\s*cards?|itunes\s*cards?|apple\s*gift\s*cards?|steam\s*(?:gift\s*)?cards?|amazon\s*gift\s*cards?|google\s*play\s*cards?|vanilla\s*visa)\b/i,
  /\b(?:bitcoin|btc|usdt|tether|ethereum|eth|crypto\s*wallet|binance|solana)\b/i
];

// Multiline Remit To / Banking details block
const REMIT_BLOCK_REGEX = /(?:remit(?:tance)?(?:\s+to|\s+details)?|send\s+(?:payment|funds)\s+to|banking\s+details|wire\s+instructions|payment\s+instructions)[\s:]*\n([\s\S]{10,400}?)(?:\n\s*\n|$)/i;

// Email addresses regex
const EMAIL_REGEX = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

/**
 * Deterministic backstop scanner.
 * Examines raw text and extracted body independently of any AI output.
 */
export function scanBackstop(rawText: string): BackstopSignals {
  // 1. Scan for IBANs
  const ibanMatches = rawText.match(IBAN_REGEX) || [];
  // Filter plausible IBANs (must have valid format: 2 letters, 2 digits, min length 15)
  const validIbans = Array.from(new Set(
    ibanMatches
      .map(s => s.replace(/\s+/g, '').toUpperCase())
      .filter(s => s.length >= 15 && s.length <= 34 && /^[A-Z]{2}\d{2}/.test(s))
  ));

  // 2. Scan for Bank Account Numbers
  const accountNumbersFound: string[] = [];
  for (const pattern of ACCOUNT_PATTERNS) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(rawText)) !== null) {
      if (match[1]) {
        const val = match[1].trim();
        if (val.length >= 4 && !accountNumbersFound.includes(val)) {
          accountNumbersFound.push(val);
        }
      }
    }
  }

  // 3. Scan for Payment Change Announcement Phrases
  const paymentChangePhrases: string[] = [];
  for (const { regex, lang } of PAYMENT_CHANGE_PATTERNS) {
    const match = rawText.match(regex);
    if (match) {
      paymentChangePhrases.push(`[${lang}] "${match[0].trim()}"`);
    }
  }

  // 4. Crypto or Gift Card requests
  let cryptoOrGiftCards = false;
  for (const pattern of CRYPTO_GIFT_PATTERNS) {
    if (pattern.test(rawText)) {
      cryptoOrGiftCards = true;
      break;
    }
  }

  // 5. Remit to: multi-line block
  let remitToBlock: string | null = null;
  const remitMatch = rawText.match(REMIT_BLOCK_REGEX);
  if (remitMatch && remitMatch[1]) {
    remitToBlock = remitMatch[1].trim();
  }

  // 6. PayPal / email addresses mentioned in text
  const allEmails = rawText.match(EMAIL_REGEX) || [];
  const paypalEmailsFound = Array.from(new Set(allEmails.map(e => e.toLowerCase())));

  return {
    ibanFound: validIbans,
    accountNumbersFound,
    cryptoOrGiftCards,
    paymentChangePhrases,
    remitToBlock,
    paypalEmailsFound
  };
}
