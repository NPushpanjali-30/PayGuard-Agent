import { InvoiceAttachment, InvoiceData } from '../../domain/types.js';

export interface IInvoiceReader {
  readInvoice(attachment: InvoiceAttachment): Promise<InvoiceData>;
  readonly isFallback: boolean;
}
