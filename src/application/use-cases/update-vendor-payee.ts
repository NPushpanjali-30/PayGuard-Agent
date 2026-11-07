import { IRepository } from '../ports/repository.js';
import { Vendor } from '../../domain/types.js';

export interface UpdateVendorPayeeOptions {
  vendorId: string;
  newPayeeEmail: string;
  actor: string;
  reason: string;
}

export class UpdateVendorPayeeUseCase {
  private repository: IRepository;

  constructor(repository: IRepository) {
    this.repository = repository;
  }

  execute(options: UpdateVendorPayeeOptions): Vendor {
    const { vendorId, newPayeeEmail, actor, reason } = options;

    if (!newPayeeEmail || !newPayeeEmail.includes('@')) {
      throw new Error('A valid PayPal email address is required.');
    }

    if (!reason || reason.trim().length < 5) {
      throw new Error('A detailed reason (min 5 characters) is required to update a vendor payee account.');
    }

    this.repository.updateVendorPayee(vendorId, newPayeeEmail, actor, reason);

    const updated = this.repository.getVendorById(vendorId);
    if (!updated) {
      throw new Error(`Vendor ${vendorId} not found.`);
    }

    return updated;
  }
}
