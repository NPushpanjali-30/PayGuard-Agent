import { IInvoiceReader } from '../../application/ports/invoice-reader.js';
import { InvoiceAttachment, InvoiceData } from '../../domain/types.js';
import { SAMPLE_EMAILS } from './sample-data.js';

export class FallbackInvoiceReader implements IInvoiceReader {
  public readonly isFallback = true;

  async readInvoice(attachment: InvoiceAttachment): Promise<InvoiceData> {
    // Check if attachment belongs to a recorded sample
    for (const sample of SAMPLE_EMAILS) {
      if ((sample as any).attachments) {
        const match = (sample as any).attachments.find(
          (a: any) =>
            a.filename.toLowerCase() === attachment.filename.toLowerCase() ||
            (attachment.contentBase64 && a.contentBase64 && a.contentBase64 === attachment.contentBase64)
        );
        if (match && match.recordedInvoiceData) {
          return match.recordedInvoiceData;
        }
      }
    }

    // Default fallback when no AI key and not a recorded sample:
    // Mark as unreadable so the deterministic decision engine triggers attachment_not_read (CHECK)
    return {
      vendorName: null,
      payeeIdentifiers: [],
      amount: null,
      currency: null,
      invoiceNumber: null,
      dueDate: null,
      bankChangeMentioned: false,
      hiddenInstructionsDetected: false,
      rawExtractedText: '',
      unreadable: true
    };
  }
}
