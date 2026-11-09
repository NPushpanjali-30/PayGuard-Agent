CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  paypal_emails TEXT NOT NULL,
  domains TEXT NOT NULL,
  phone TEXT,
  contact_email TEXT,
  typical_amount REAL NOT NULL DEFAULT 0,
  payment_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  vendor_id TEXT,
  vendor_name TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  payee TEXT,
  requested_payee_in_email TEXT,
  verdict TEXT NOT NULL,
  flags TEXT NOT NULL,
  status TEXT NOT NULL,
  requires_callback_check INTEGER NOT NULL DEFAULT 0,
  requires_amount_confirm INTEGER NOT NULL DEFAULT 0,
  is_hard_blocked INTEGER NOT NULL DEFAULT 0,
  callback_confirmed INTEGER NOT NULL DEFAULT 0,
  callback_note TEXT,
  approval_note TEXT,
  rejection_reason TEXT,
  paypal_batch_id TEXT,
  paypal_payout_item_id TEXT,
  raw_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS intake_messages (
  message_id TEXT PRIMARY KEY,
  proposal_id TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  payee_email TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  paypal_batch_id TEXT,
  paid_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  target_id TEXT,
  details TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_senders (
  id TEXT PRIMARY KEY,
  domain TEXT,
  address TEXT,
  reason TEXT NOT NULL,
  source_proposal_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_payees (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  source_proposal_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_vendor ON payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_blocked_senders_domain ON blocked_senders(domain);
CREATE INDEX IF NOT EXISTS idx_blocked_senders_address ON blocked_senders(address);
CREATE INDEX IF NOT EXISTS idx_blocked_payees_identifier ON blocked_payees(identifier);
