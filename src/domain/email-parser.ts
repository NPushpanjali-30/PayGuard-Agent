import { EmailHeaders, ParsedEmail } from './types.js';

/**
 * Extracts email address and display name from a header value like:
 * "John Doe <john.doe@example.com>" or "billing@acme-corp.com"
 */
export function extractAddressAndName(headerValue: string): { name: string; address: string; domain: string } {
  if (!headerValue || typeof headerValue !== 'string') {
    return { name: '', address: '', domain: '' };
  }

  const trimmed = headerValue.trim();
  const angleMatch = trimmed.match(/^(?:(?:"?([^"<]*)"?\s*)?<)?([^>\s]+@[^>\s]+)>?$/);

  if (angleMatch) {
    const rawName = (angleMatch[1] || '').trim();
    const address = (angleMatch[2] || '').trim().toLowerCase();
    const domain = address.includes('@') ? address.split('@')[1] : '';
    return { name: rawName, address, domain };
  }

  // Fallback: look for first string containing @
  const emailMatch = trimmed.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    const address = emailMatch[1].toLowerCase();
    const domain = address.split('@')[1];
    const name = trimmed.replace(emailMatch[0], '').replace(/[<>"]/g, '').trim();
    return { name, address, domain };
  }

  return { name: trimmed, address: '', domain: '' };
}

/**
 * Parses raw email text containing headers and body.
 */
export function parseRawEmail(rawEmail: string): ParsedEmail {
  const normalized = rawEmail.replace(/\r\n/g, '\n');
  
  // RFC 822 defines headers and body separated by an empty line
  const splitIndex = normalized.search(/\n\n/);
  
  let headerSection = '';
  let bodySection = '';

  if (splitIndex !== -1) {
    headerSection = normalized.slice(0, splitIndex);
    bodySection = normalized.slice(splitIndex + 2);
  } else {
    // If no clear blank line separator, check if first lines look like headers
    const lines = normalized.split('\n');
    let inHeader = true;
    const headerLines: string[] = [];
    const bodyLines: string[] = [];

    for (const line of lines) {
      if (inHeader && /^[A-Za-z0-9-]+:\s*.+/.test(line)) {
        headerLines.push(line);
      } else {
        inHeader = false;
        bodyLines.push(line);
      }
    }

    if (headerLines.length > 0) {
      headerSection = headerLines.join('\n');
      bodySection = bodyLines.join('\n');
    } else {
      bodySection = normalized;
    }
  }

  // Parse headers (handling multiline folded headers starting with space or tab)
  const headers: EmailHeaders = {};
  const headerLines = headerSection.split('\n');
  let currentKey = '';
  let currentValue = '';

  for (const line of headerLines) {
    if (/^[ \t]+/.test(line) && currentKey) {
      currentValue += ' ' + line.trim();
    } else {
      if (currentKey) {
        headers[currentKey.toLowerCase()] = currentValue.trim();
      }
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        currentKey = line.slice(0, colonIndex).trim().toLowerCase();
        currentValue = line.slice(colonIndex + 1).trim();
      } else {
        currentKey = '';
        currentValue = '';
      }
    }
  }
  if (currentKey) {
    headers[currentKey.toLowerCase()] = currentValue.trim();
  }

  // Extract key headers
  const fromHeader = headers['from'] || '';
  const replyToHeader = headers['reply-to'] || '';
  const toHeader = headers['to'] || '';
  const subjectHeader = headers['subject'] || '';
  const authResults = headers['authentication-results'] || headers['received-spf'] || '';

  const senderInfo = extractAddressAndName(fromHeader);
  const replyToInfo = replyToHeader ? extractAddressAndName(replyToHeader) : undefined;

  // Clean body text (strip basic HTML if present)
  let cleanBody = bodySection;
  if (/<[a-z][\s\S]*>/i.test(bodySection)) {
    cleanBody = bodySection
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  return {
    senderName: senderInfo.name,
    senderAddress: senderInfo.address,
    senderDomain: senderInfo.domain,
    replyToAddress: replyToInfo?.address || undefined,
    replyToDomain: replyToInfo?.domain || undefined,
    subject: subjectHeader,
    body: cleanBody.trim(),
    headers: {
      from: fromHeader,
      replyTo: replyToHeader || undefined,
      to: toHeader || undefined,
      subject: subjectHeader || undefined,
      authResults: authResults || undefined,
      ...headers
    },
    raw: rawEmail
  };
}
