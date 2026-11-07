import { ParsedEmail, EmailAIAnalysis } from '../../domain/types.js';

export interface IEmailReader {
  readEmail(parsedEmail: ParsedEmail): Promise<EmailAIAnalysis>;
  readonly isFallback: boolean;
}
