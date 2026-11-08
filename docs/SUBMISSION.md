# PayGuard Agent: Devpost Project Submission

## Tagline
An AI agent that checks payment-request emails against your PayPal payment history, holds anything suspicious, and only sends money after a human approves.

---

## Inspiration
Business Email Compromise (BEC) is the costliest cybercrime facing small businesses today, accounting for billions in annual losses according to the FBI Internet Crime Report. The typical attack vector is deceptively simple: an attacker compromises a vendor's email account or buys a lookalike domain, sends an invoice stating *"our banking details have changed, please remit payment today"*, and a busy bookkeeper pays without a second check.

Small business owners and bookkeepers pay dozens of recurring invoices each month through digital channels like PayPal. They don't have corporate security teams or expensive enterprise SIEM platforms. We wanted to build an autonomous agent that acts as an unblinking guardian: intercepting invoice emails, verifying them against genuine PayPal transaction history, holding anything unusual, and requiring out-of-band human verification before any money moves.

---

## What It Does
PayGuard Agent is a full-stack, human-in-the-loop autonomous payment protection platform:
1. **Multi-layer Email Ingestion & Parsing:** Small business operators paste raw invoice emails or forward them. PayGuard extracts RFC 822 headers (From, Reply-To, Authentication-Results) and message bodies.
2. **AI Extraction & Independent Second Opinion:** Google Gemini 2.5 Flash analyzes the email with strict structured JSON schema extraction (vendorName, paymentRequested, payeeChangeRequested, tactics like urgency/secrecy/phone avoidance, channel shifting, gift cards). An independent second opinion call evaluates deception and can escalate flags.
3. **Deterministic Backstop & 16-Rule Security Checklist:** A regex scanner detects account numbers, IBANs, multi-line Remit-to blocks, and payment change phrasing in English, Spanish, French, German, and Portuguese. A 16-rule checklist flags lookalike domains (Levenshtein distance, homoglyphs, swapped TLDs, hyphen tricks), reply-to mismatches, unlisted payees, and amount anomalies (>3x median).
4. **Deterministic Decision Table:**
   - **HOLD:** High-risk indicators (payee changes, lookalike domains, reply-to hijacking). Locks the proposal to the payee *on file* and mandates ticking *"I called the number on file"* with a written callback note.
   - **CHECK:** Verification recommended (first-time vendor, minor anomalies, fallback mode).
   - **CLEAR:** Verified vendor, registered payee, established payment history, 0 flags.
5. **Agentic Commerce via PayPal Payouts:** When a proposal is approved, PayGuard calls the **PayPal Payouts API** (`POST /v1/payments/payouts`) with an idempotent `sender_batch_id`, tracks transaction status, and stores the completed settlement in local payment history.
6. **Append-Only Audit Trail:** Every email check, flag calculation, human note, and PayPal batch response is recorded in an immutable audit ledger exportable as CSV.

---

## How It Was Built
- **Architecture:** Clean Hexagonal / Layered Architecture. Pure domain core (`src/domain/`) with zero external I/O or library dependencies, strictly verified by automated linting (`npm run layers`).
- **Backend:** Express, Node 20+, TypeScript, `better-sqlite3` with WAL mode and atomic transaction rollbacks, `@google/genai` (Google Gen AI SDK), `pino` logging with secrets redaction, `helmet`, and `express-rate-limit`.
- **Payment Layer:** Dual-mode PayPal client:
  - **Mock Mode:** In-memory state machine simulating OAuth token issuance, payout creation, duplicate batch idempotency, and status auto-transitioning from `PENDING` to `SUCCESS` after 3 seconds. Zero credentials required.
  - **Sandbox Mode:** Live calls to `https://api-m.sandbox.paypal.com` with OAuth2 caching, 31-day chunked transaction reporting (`GET /v1/reporting/transactions`), and webhook signature verification (`POST /v1/notifications/verify-webhook-signature`).
- **Frontend:** React 18, Vite, TypeScript, plain CSS with responsive layouts, accessible focus rings, light/dark themes, and reduced-motion support.

---

## Challenges We Ran Into
1. **Preventing Prompt Injection in Untrusted Emails:** BEC emails often contain manipulative instructions (*"Ignore previous invoices", "Do not contact accounting"*). We established a system prompt invariant treating all email contents strictly as passive data and enforcing a strict JSON schema output.
2. **Eliminating Lookalike Typosquatting:** Attackers use subtle tricks: replacing `.com` with `.co`, inserting hyphens (`reliable-cloud.com`), homoglyphs (`cl0ud`), and brand keywords (`acme-payments.com`). We built a custom multi-strategy domain comparator combining Levenshtein distance, homoglyph normalization, TLD stripping, and keyword matching.
3. **PayPal Reporting API Interval Limits:** PayPal's Transaction Search API enforces a strict 31-day maximum date range per request. We implemented automated range chunking that divides 90-day search windows into 31-day intervals and gracefully falls back to local history if reporting is unavailable in the sandbox account.

---

## Accomplishments That We're Proud Of
- **100% Zero-Credential Demo Experience:** Anyone can clone the repository, run `npm install && npm start`, and experience the complete flow with realistic recorded samples, instant mock payouts, and full dashboard analytics without needing API keys.
- **Genuine Human-in-the-Loop Safeguards:** The AI never moves money on its own. For held proposals, approval is physically disabled until the bookkeeper confirms an out-of-band callback using a phone number that is guaranteed to come *only* from verified records.
- **Architectural Boundary Enforcement:** Automated tests (`npm run layers`) ensure the domain layer remains 100% pure and decoupled from frameworks and databases.

---

## How It Was Significantly Extended During the Hackathon

During the hackathon, PayGuard was transformed from a text-only email prototype into an end-to-end, enterprise-ready payment defense ecosystem spanning six major feature systems:

1. **Multimodal PDF & Image Invoice Extraction (Feature 1):**
   - Implemented `InvoiceReader` port and `GeminiInvoiceReader` adapter supporting multimodal inline data for PDFs, PNGs, and JPEGs.
   - Enforced strict magic byte validation (`%PDF-`, `\x89PNG`, `\xFF\xD8\xFF`) to prevent polyglot file uploads.
   - Added pure domain rules: `attachment_payee_mismatch` (HIGH), `attachment_amount_mismatch` (HIGH if >=2x), `attachment_new_payee` (HIGH), `attachment_hidden_instructions` (HIGH), and `attachment_not_read` (MEDIUM, forcing CHECK).
   - Built an interactive side-by-side comparison view in the UI highlighting discrepancies between email claims, invoice attachments, and vendor records.

2. **Cryptographic Out-of-Band Vendor Confirmation (Feature 2):**
   - Engineered an out-of-band verification workflow generating crypto-random 32-byte single-use tokens stored as SHA-256 hashes with configurable TTL.
   - Created a rate-limited public confirmation portal (`GET /confirm/:token`) allowing vendors to confirm or deny invoices with zero login friction.
   - Built a dual-mode notification adapter: real SMTP email delivery (via `nodemailer`) or a zero-credential Demo Outbox mode.
   - Enforced automatic blocking: if a vendor responds `DENIED`, the proposal is immediately auto-BLOCKED and logged to the audit trail.

3. **Two-Person Approval & Cooling-Off Periods (Feature 3):**
   - Implemented maker-checker governance: transactions exceeding `DUAL_APPROVAL_THRESHOLD` ($1,000) or directed to first-time payees mandate approval by two distinct logged-in users.
   - Enforced a 24-hour cooling-off holding period for payments to unverified payees, preventing rush payment execution.
   - Added an audit-logged `DEMO_FAST_FORWARD` bypass control for frictionless testing and live demonstrations.

4. **Zapier & Webhook Automated Email Intake (Feature 4):**
   - Created a secure ingestion pipeline at `POST /api/intake/email` with constant-time `X-Intake-Key` authentication and 8 MB payload support.
   - Built a persistent `intake_messages` idempotency engine ensuring identical `messageId` requests return cached verdicts without duplicate processing.
   - Authored complete integration documentation (`docs/ZAPIER.md`) with step-by-step Gmail-to-Zapier instructions.

5. **Model Context Protocol (MCP) Server (Feature 5):**
   - Built a dedicated stdio MCP server (`src/mcp/server.ts`, executable via `npm run mcp`) adhering to the official `@modelcontextprotocol/sdk`.
   - Exposed 5 safe tools (`payguard_check_email`, `payguard_request_payment`, `payguard_list_pending`, `payguard_get_proposal`, `payguard_vendor_lookup`) allowing autonomous AI agents in Claude Desktop, Cursor, or custom pipelines to verify payments before acting.
   - Embedded a strict architectural invariant in tool descriptions: external agents may request checks or payment proposals, but humans *must* approve within the PayGuard UI.

6. **Dynamic Security Blocklist Learning (Feature 6):**
   - Created database-backed threat intelligence tables (`blocked_senders`, `blocked_payees`).
   - Integrated learned threat mitigation into proposal rejection: approvers can one-click block attacker domains and payee handles upon rejecting fraudulent requests.
   - Built an unbreachable vendor protection invariant preventing any verified vendor domain or payee from ever being blocklisted.
   - Added pure domain rules `blocklisted_sender` and `blocklisted_payee` that immediately freeze matched future requests into `HOLD`.

---

## Inspired by Public Work on Payee-Change Fraud

PayGuard Agent's threat model and defense architecture were directly inspired by publicly documented payee-redirection schemes and vendor email compromise (VEC) research published by the **FBI Internet Crime Complaint Center (IC3)**, the **Cybersecurity and Infrastructure Security Agency (CISA)**, and leading cyber insurance forensics reports. Real-world BEC attacks rarely rely on malware; they exploit trust by injecting altered banking coordinates at the moment of invoice settlement. PayGuard operationalizes defensive best practices—dual approval, verified out-of-band callbacks, payee locking to historical ground truth, and mandatory cooling-off delays—into an autonomous agentic system for digital commerce.

---

## What We Learned
- How agentic workflows in financial commerce require strict determinism. While generative models are exceptional at unstructured text comprehension and nuance across languages, mission-critical decisions must be grounded by deterministic backstops and business policies.
- Deep integration patterns for PayPal Sandbox Payouts, idempotency headers, and webhook verification.

---

## What's Next for PayGuard Agent
- Direct IMAP / Google Workspace / Microsoft 365 OAuth inbox listeners to automatically scan incoming vendor emails as they arrive.
- Native PDF invoice attachment parsing and OCR to compare embedded bank routing details against email body text.
- Automated out-of-band Twilio / WhatsApp verification voice prompts for high-value payouts.

---

## Tools & Technologies Used
- **PayPal APIs:** PayPal Payouts API (`/v1/payments/payouts`), OAuth2 Token API (`/v1/oauth2/token`), Reporting API (`/v1/reporting/transactions`), Webhook Verification API (`/v1/notifications/verify-webhook-signature`).
- **AI Models:** Google Gemini 2.5 Flash via `@google/genai` (structured JSON response schemas, temperature 0).
- **Core Stack:** TypeScript, Node.js 20+, Express, better-sqlite3, Vite, React, Vitest, Supertest, Pino, Helmet.
