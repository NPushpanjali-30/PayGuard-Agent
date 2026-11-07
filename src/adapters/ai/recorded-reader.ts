import { IEmailReader } from '../../application/ports/email-reader.js';
import { ParsedEmail, EmailAIAnalysis, SecondOpinion } from '../../domain/types.js';
import { SAMPLE_EMAILS, SampleEmailItem } from './sample-data.js';
import { KeywordReader } from './keyword-reader.js';

export class RecordedReader implements IEmailReader {
  public readonly isFallback = false;
  private fallback: KeywordReader;

  constructor() {
    this.fallback = new KeywordReader();
  }

  findSample(parsedEmail: ParsedEmail): SampleEmailItem | undefined {
    const rawNormalized = parsedEmail.raw.replace(/\r\n/g, '\n').trim();
    return SAMPLE_EMAILS.find(sample => {
      const sampleNormalized = sample.rawEmail.replace(/\r\n/g, '\n').trim();
      return (
        rawNormalized === sampleNormalized ||
        rawNormalized.includes(sample.title) ||
        (sample.rawEmail.includes(parsedEmail.subject) && parsedEmail.subject.length > 5)
      );
    });
  }

  async readEmail(parsedEmail: ParsedEmail): Promise<EmailAIAnalysis> {
    const match = this.findSample(parsedEmail);
    if (match) {
      return match.recordedReading;
    }
    return this.fallback.readEmail(parsedEmail);
  }

  getRecordedSecondOpinion(parsedEmail: ParsedEmail): SecondOpinion | null {
    const match = this.findSample(parsedEmail);
    return match ? match.recordedSecondOpinion : null;
  }
}
