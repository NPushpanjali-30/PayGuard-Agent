import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Vendor } from '../types.js';

export const VendorsPage: React.FC = () => {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Edit Payee Modal State
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [newPayee, setNewPayee] = useState('');
  const [payeeChangeReason, setPayeeChangeReason] = useState('');
  const [submittingPayeeChange, setSubmittingPayeeChange] = useState(false);

  // Edit Contact Email Modal State
  const [editingContactVendor, setEditingContactVendor] = useState<Vendor | null>(null);
  const [newContactEmail, setNewContactEmail] = useState('');
  const [submittingContactEmail, setSubmittingContactEmail] = useState(false);

  // Add Vendor Modal State
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [vendorName, setVendorName] = useState('');
  const [vendorEmail, setVendorEmail] = useState('');
  const [vendorContactEmail, setVendorContactEmail] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [vendorDomains, setVendorDomains] = useState('');
  const [vendorAmount, setVendorAmount] = useState('0');
  const [submittingAddVendor, setSubmittingAddVendor] = useState(false);

  // CSV Import State
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [importingCsv, setImportingCsv] = useState(false);

  const loadVendors = async () => {
    try {
      setLoading(true);
      const data = await api.getVendors();
      setVendors(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVendors();
  }, []);

  const handleSyncPayPal = async () => {
    setError(null);
    setSuccessMsg(null);
    setSyncing(true);
    try {
      const res = await api.syncPayPalHistory();
      setSuccessMsg(res.message);
      await loadVendors();
    } catch (err: any) {
      setError(err.message || 'PayPal sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenEditPayee = (v: Vendor) => {
    setEditingVendor(v);
    setNewPayee(v.paypalEmails[0] || '');
    setPayeeChangeReason('');
  };

  const handleSubmitEditPayee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVendor) return;

    setError(null);
    setSubmittingPayeeChange(true);

    try {
      await api.updateVendorPayee(editingVendor.id, newPayee.trim(), payeeChangeReason.trim());
      setSuccessMsg(`Payee on file for ${editingVendor.name} successfully updated to ${newPayee.trim()}.`);
      setEditingVendor(null);
      await loadVendors();
    } catch (err: any) {
      setError(err.message || 'Failed to update payee');
    } finally {
      setSubmittingPayeeChange(false);
    }
  };

  const handleSubmitEditContactEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContactVendor) return;

    setError(null);
    setSubmittingContactEmail(true);

    try {
      await api.updateVendorContactEmail(editingContactVendor.id, newContactEmail.trim() || null);
      setSuccessMsg(`Verified contact email on file for ${editingContactVendor.name} updated.`);
      setEditingContactVendor(null);
      await loadVendors();
    } catch (err: any) {
      setError(err.message || 'Failed to update contact email');
    } finally {
      setSubmittingContactEmail(false);
    }
  };

  const handleCreateVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmittingAddVendor(true);

    try {
      const domains = vendorDomains
        .split(',')
        .map(d => d.trim())
        .filter(Boolean);

      await api.createVendor({
        name: vendorName.trim(),
        payeeEmail: vendorEmail.trim(),
        contactEmail: vendorContactEmail.trim() || null,
        phone: vendorPhone.trim() || null,
        domains,
        typicalAmount: parseFloat(vendorAmount) || 0
      });

      setSuccessMsg(`Vendor ${vendorName} added successfully.`);
      setShowAddVendor(false);
      setVendorName('');
      setVendorEmail('');
      setVendorContactEmail('');
      setVendorPhone('');
      setVendorDomains('');
      setVendorAmount('0');
      await loadVendors();
    } catch (err: any) {
      setError(err.message || 'Failed to add vendor');
    } finally {
      setSubmittingAddVendor(false);
    }
  };

  const handleImportCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvContent.trim()) return;

    setError(null);
    setImportingCsv(true);

    try {
      const res = await api.importCsvVendors(csvContent);
      if (res.errors.length > 0) {
        setError(`Imported ${res.importedCount} vendor(s) with warnings: ${res.errors.join('; ')}`);
      } else {
        setSuccessMsg(`Successfully imported ${res.importedCount} vendor(s) from CSV.`);
      }
      setShowCsvImport(false);
      setCsvContent('');
      await loadVendors();
    } catch (err: any) {
      setError(err.message || 'CSV import failed');
    } finally {
      setImportingCsv(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Vendor Records &amp; Payment History</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Ground-truth payee directory. The AI agent only pays addresses registered here.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={handleSyncPayPal} disabled={syncing}>
            {syncing ? 'Syncing...' : '↻ Sync from PayPal'}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setShowCsvImport(true)}>
            📥 Import CSV
          </button>
          <a href="/api/vendors/template.csv" download className="btn btn-outline">
            📄 Template CSV
          </a>
          <button type="button" className="btn btn-primary" onClick={() => setShowAddVendor(true)}>
            + Add Vendor
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="badge badge-success" style={{ width: '100%', padding: '0.75rem', marginBottom: '1.25rem' }}>
          {successMsg}
        </div>
      )}

      {error && (
        <div className="badge badge-danger" style={{ width: '100%', padding: '0.75rem', marginBottom: '1.25rem' }}>
          {error}
        </div>
      )}

      {/* Vendors Table */}
      <div className="card">
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading vendor records...
          </div>
        ) : vendors.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No vendors registered yet. Import via CSV or run <code>npm run seed</code> to populate sample records.
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vendor Name</th>
                  <th>PayPal Payee on File</th>
                  <th>Verified Contact Email</th>
                  <th>Registered Domains</th>
                  <th>Verified Phone</th>
                  <th>Typical Amount</th>
                  <th>Payments</th>
                  <th>Source</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map(v => (
                  <tr key={v.id}>
                    <td>
                      <strong>{v.name}</strong>
                    </td>
                    <td>
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                        {v.paypalEmails[0]}
                      </code>
                      {v.paypalEmails.length > 1 && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                          +{v.paypalEmails.length - 1} alt email(s)
                        </span>
                      )}
                    </td>
                    <td>
                      {v.contactEmail ? (
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                          {v.contactEmail}
                        </code>
                      ) : (
                        <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                          None on File
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {v.domains.join(', ') || <span style={{ color: 'var(--text-muted)' }}>None</span>}
                    </td>
                    <td>
                      {v.phone ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{v.phone}</span>
                      ) : (
                        <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                          No Phone
                        </span>
                      )}
                    </td>
                    <td>${v.typicalAmount.toFixed(2)}</td>
                    <td>{v.paymentCount}</td>
                    <td>
                      <span className="badge badge-muted" style={{ fontSize: '0.7rem' }}>
                        {v.source}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => handleOpenEditPayee(v)}
                        >
                          Edit Payee
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => {
                            setEditingContactVendor(v);
                            setNewContactEmail(v.contactEmail || '');
                          }}
                        >
                          Edit Contact
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Payee Modal */}
      {editingVendor && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="card-title">Update Payee on File: {editingVendor.name}</h3>
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '0.2rem 0.5rem' }}
                onClick={() => setEditingVendor(null)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              <strong>Audit Notice:</strong> Updating a vendor's PayPal payee address permanently redirects future disbursements. Small business security policy mandates logging an explanation of how this change was independently verified.
            </p>

            <form onSubmit={handleSubmitEditPayee}>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-payee-input">
                  New Verified PayPal Payee Email:
                </label>
                <input
                  id="edit-payee-input"
                  type="email"
                  className="form-input"
                  value={newPayee}
                  onChange={e => setNewPayee(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="edit-payee-reason">
                  Verification Justification (Mandatory, min 5 chars):
                </label>
                <textarea
                  id="edit-payee-reason"
                  className="form-textarea"
                  style={{ height: '80px' }}
                  placeholder="e.g. Spoke directly with vendor CEO on verified phone number from original contract."
                  value={payeeChangeReason}
                  onChange={e => setPayeeChangeReason(e.target.value)}
                  required
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setEditingVendor(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingPayeeChange || payeeChangeReason.trim().length < 5}
                >
                  {submittingPayeeChange ? 'Saving...' : 'Update & Log to Audit Trail'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Contact Email Modal */}
      {editingContactVendor && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="card-title">Update Verified Contact Email: {editingContactVendor.name}</h3>
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '0.2rem 0.5rem' }}
                onClick={() => setEditingContactVendor(null)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              <strong>Out-of-Band Security Contact:</strong> This verified email is used exclusively for out-of-band confirmation requests. It is never automatically populated from incoming invoice emails.
            </p>

            <form onSubmit={handleSubmitEditContactEmail}>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-contact-email-input">
                  Verified Vendor Contact Email:
                </label>
                <input
                  id="edit-contact-email-input"
                  type="email"
                  className="form-input"
                  placeholder="contact@vendor.com"
                  value={newContactEmail}
                  onChange={e => setNewContactEmail(e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setEditingContactVendor(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingContactEmail}
                >
                  {submittingContactEmail ? 'Saving...' : 'Save Contact Email'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Vendor Modal */}
      {showAddVendor && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="card-title">Add Verified Vendor Record</h3>
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '0.2rem 0.5rem' }}
                onClick={() => setShowAddVendor(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateVendor}>
              <div className="form-group">
                <label className="form-label" htmlFor="new-vendor-name">
                  Vendor / Company Name:
                </label>
                <input
                  id="new-vendor-name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Reliable Cloud Inc"
                  value={vendorName}
                  onChange={e => setVendorName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="new-vendor-email">
                  Authorized PayPal Payee Email:
                </label>
                <input
                  id="new-vendor-email"
                  type="email"
                  className="form-input"
                  placeholder="billing@reliablecloud.com"
                  value={vendorEmail}
                  onChange={e => setVendorEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="new-vendor-contact-email">
                  Verified Contact Email (Out-of-Band Confirmation on File):
                </label>
                <input
                  id="new-vendor-contact-email"
                  type="email"
                  className="form-input"
                  placeholder="contact@reliablecloud.com"
                  value={vendorContactEmail}
                  onChange={e => setVendorContactEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="new-vendor-phone">
                  Verified Contact Phone (Strictly used for Out-of-Band Callbacks):
                </label>
                <input
                  id="new-vendor-phone"
                  type="text"
                  className="form-input"
                  placeholder="+1-555-0199"
                  value={vendorPhone}
                  onChange={e => setVendorPhone(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="new-vendor-domains">
                  Legitimate Sender Domains (comma-separated):
                </label>
                <input
                  id="new-vendor-domains"
                  type="text"
                  className="form-input"
                  placeholder="reliablecloud.com, billing.reliablecloud.com"
                  value={vendorDomains}
                  onChange={e => setVendorDomains(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="new-vendor-amount">
                  Typical Invoice Amount ($ USD):
                </label>
                <input
                  id="new-vendor-amount"
                  type="number"
                  step="0.01"
                  className="form-input"
                  value={vendorAmount}
                  onChange={e => setVendorAmount(e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowAddVendor(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submittingAddVendor}>
                  {submittingAddVendor ? 'Adding...' : 'Save Vendor Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showCsvImport && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="card-title">Import Vendors from CSV</h3>
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '0.2rem 0.5rem' }}
                onClick={() => setShowCsvImport(false)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Paste CSV contents below or select a file. Tolerant of comma (,) or semicolon (;) delimiters and varied column headings.
            </p>

            <form onSubmit={handleImportCsv}>
              <div className="form-group">
                <label className="form-label" htmlFor="csv-content-input">
                  Paste CSV Content:
                </label>
                <textarea
                  id="csv-content-input"
                  className="form-textarea"
                  style={{ height: '180px' }}
                  placeholder="vendor,payee_email,amount,phone,domain&#10;Acme Supplies,billing@acme.com,450.00,+1-555-0144,acme.com"
                  value={csvContent}
                  onChange={e => setCsvContent(e.target.value)}
                  required
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowCsvImport(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={importingCsv}>
                  {importingCsv ? 'Importing...' : 'Parse & Import CSV'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
