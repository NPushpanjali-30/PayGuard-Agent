/**
 * Pure Domain Attachment Validator.
 * Validates file constraints (max 3 attachments, max 5 MB each)
 * and detects actual file format from binary magic bytes (PDF, PNG, JPG).
 */

export const MAX_ATTACHMENTS_COUNT = 3;
export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export type SupportedMimeType = 'application/pdf' | 'image/png' | 'image/jpeg';

export interface AttachmentValidationResult {
  valid: boolean;
  mimeType?: SupportedMimeType;
  error?: string;
}

/**
 * Validates binary buffer against real magic bytes.
 */
export function validateAttachmentMagicBytes(
  buffer: Uint8Array | Buffer
): AttachmentValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Empty file buffer' };
  }

  if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds the 5 MB limit (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`
    };
  }

  // 1. PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return { valid: true, mimeType: 'application/pdf' };
  }

  // 2. PNG: \x89PNG\r\n\x1a\n (0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, mimeType: 'image/png' };
  }

  // 3. JPEG/JPG: \xFF\xD8\xFF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { valid: true, mimeType: 'image/jpeg' };
  }

  return {
    valid: false,
    error: 'Unsupported file format. Only legitimate PDF, PNG, and JPEG documents are permitted.'
  };
}
