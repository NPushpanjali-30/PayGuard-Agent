import crypto from 'node:crypto';
import { IRepository } from '../ports/repository.js';
import { IPayPalClient } from '../ports/paypal-client.js';
import { PaymentRecord, Vendor } from '../../domain/types.js';

export interface SyncHistoryResult {
  syncedTransactionsCount: number;
  localPaymentsCount: number;
  updatedVendorsCount: number;
  message: string;
}

export class SyncHistoryUseCase {
  private repository: IRepository;
  private payPalClient: IPayPalClient;

  constructor(repository: IRepository, payPalClient: IPayPalClient) {
    this.repository = repository;
    this.payPalClient = payPalClient;
  }

  async execute(actor: string = 'system'): Promise<SyncHistoryResult> {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    let syncedTransactions: any[] = [];
    let message = 'Transaction history synced from local database.';

    try {
      syncedTransactions = await this.payPalClient.syncTransactionHistory(
        ninetyDaysAgo.toISOString(),
        now.toISOString()
      );
      if (syncedTransactions.length > 0) {
        message = `Successfully synced ${syncedTransactions.length} transaction(s) from PayPal.`;
      } else {
        message = 'PayPal transaction search returned 0 records. Working from local payment history.';
      }
    } catch (err: any) {
      console.warn(`[SyncHistory] PayPal search failed (${err.message}). Using local payment history.`);
      message = `PayPal Transaction API notice: ${err.message}. Operating safely from local payment database.`;
    }

    let updatedVendorsCount = 0;

    // Merge transactions into local database & recalculate typical vendor amounts
    this.repository.runInTransaction(() => {
      const existingPayments = this.repository.getPaymentRecords();
      const existingTxIds = new Set(existingPayments.map(p => p.paypalBatchId).filter(Boolean));

      for (const tx of syncedTransactions) {
        if (!existingTxIds.has(tx.transactionId)) {
          // Find matching vendor by payee email
          let matchedVendor = this.repository.getAllVendors().find(v =>
            v.paypalEmails.some(e => e.toLowerCase() === tx.payeeEmail.toLowerCase())
          );

          if (!matchedVendor) {
            // Auto-create vendor record if new payee observed
            const domain = tx.payeeEmail.includes('@') ? tx.payeeEmail.split('@')[1] : '';
            const nameCandidate = tx.payeeEmail.split('@')[0].replace(/[._-]/g, ' ');
            const formattedName = nameCandidate.charAt(0).toUpperCase() + nameCandidate.slice(1);

            matchedVendor = {
              id: 'ven_' + crypto.randomUUID().slice(0, 10),
              name: formattedName,
              paypalEmails: [tx.payeeEmail.toLowerCase()],
              domains: domain ? [domain] : [],
              phone: null,
              typicalAmount: tx.amount,
              paymentCount: 1,
              source: 'paypal',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            this.repository.saveVendor(matchedVendor);
            updatedVendorsCount++;
          }

          const record: PaymentRecord = {
            id: 'pay_' + crypto.randomUUID().slice(0, 10),
            vendorId: matchedVendor.id,
            payeeEmail: tx.payeeEmail,
            amount: tx.amount,
            currency: tx.currency,
            status: 'SUCCESS',
            paypalBatchId: tx.transactionId,
            paidAt: tx.transactionTime
          };

          this.repository.savePaymentRecord(record);
        }
      }

      // Recompute typical (median) amount and payment count for all vendors
      const allVendors = this.repository.getAllVendors();
      for (const vendor of allVendors) {
        const vendorPayments = this.repository.getPaymentRecords(vendor.id);
        if (vendorPayments.length > 0) {
          const amounts = vendorPayments.map(p => p.amount).sort((a, b) => a - b);
          const mid = Math.floor(amounts.length / 2);
          const median = amounts.length % 2 !== 0 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2;

          if (vendor.paymentCount !== vendorPayments.length || vendor.typicalAmount !== median) {
            vendor.paymentCount = vendorPayments.length;
            vendor.typicalAmount = median;
            vendor.updatedAt = new Date().toISOString();
            this.repository.saveVendor(vendor);
            updatedVendorsCount++;
          }
        }
      }
    });

    const totalLocal = this.repository.getPaymentRecords().length;

    this.repository.addAuditLog({
      action: 'PAYPAL_HISTORY_SYNCED',
      actor,
      targetId: null,
      details: {
        syncedCount: syncedTransactions.length,
        localTotal: totalLocal,
        updatedVendorsCount,
        message
      }
    });

    return {
      syncedTransactionsCount: syncedTransactions.length,
      localPaymentsCount: totalLocal,
      updatedVendorsCount,
      message
    };
  }
}
