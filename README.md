# 🛡️ PayGuard Agent

> **Tagline:** An AI agent that checks payment-request emails against your PayPal payment history, holds anything suspicious, and only sends money after a human approves.  
> **Target Award:** PayPal AI Hackathon — Best Use of Agentic Commerce.

---

## ⚡ 30-Second Quickstart (Zero Credentials Required!)

PayGuard Agent works completely out of the box with zero API keys or external credentials required:

```bash
# 1. Clone & install dependencies
git clone https://github.com/example/payguard-agent.git
cd payguard-agent
npm install

# 2. Seed realistic vendors & payment history (local SQLite)
npm run seed

# 3. Start production server (serves both API & React UI)
npm run build && npm start
```

Open **`http://localhost:3000`** in your browser:
1. Log in with the default password: **`payguard2026!`**
2. Head to **Check Email** and click the demo chip: **`🚨 Fraud: New Payee`**.
3. Click **Check This Email** → Observe instant **`HOLD`** verdict, locked payee on file, and phone callback script.
4. Click **`✓ Honest: Cloud Invoice`** → Click **Approve** → Watch status progress from `PENDING` to **`PAID`** via simulated PayPal Payouts.

---

## 📐 System Architecture

PayGuard Agent strictly enforces **Hexagonal / Clean Architecture**. Domain security rules have zero external dependencies or I/O.

```mermaid
graph TD
    Client[React Frontend / SPA] -->|JSON API + Signed Cookie| Server[Express Server + Helmet + Rate Limit]
    Server -->|Use Cases| Application[Application Layer]
    Application -->|Pure Types & Logic| Domain[Domain Layer - 100% Pure, Zero I/O]
    Application -->|Repository Port| SqliteRepo[(better-sqlite3 / WAL Mode)]
    Application -->|PayPal Port| PayPalAdapter[Real PayPal Client or Mock Client]
    Application -->|AI Port| AIAdapter[Gemini 2.5 Flash or Fallback Keyword Reader]

    subgraph "Pure Domain Core (src/domain/)"
        Domain --> Rules[16-Rule Deterministic Checklist]
        Domain --> Lookalike[Lookalike & Typo-squat Detector]
        Domain --> Backstop[Multilingual Backstop Regex Engine]
        Domain --> DecisionTable[Deterministic Decision Table]
        Domain --> Callback[Out-of-Band Callback Generator]
        Domain --> Policy[Payment Policy & Limits Engine]
    end
```

To verify layer boundaries at any time, run:
```bash
npm run layers
```
*(Fails immediately if `src/domain/` imports from `application/`, `adapters/`, `server/`, or `web/`).*

---

## 💳 Exactly How PayPal is Used

1. **PayPal Payouts API (`POST /v1/payments/payouts`):**
   - Automatically triggered when a human approves a payment proposal.
   - Enforces **Idempotency** via `sender_batch_header.sender_batch_id = proposal.id`, preventing duplicate payouts.
   - Dispatches single or batch item disbursements with custom memo references.
2. **Payout Status Polling (`GET /v1/payments/payouts/{batch_id}`):**
   - Tracks transaction lifecycle: `PENDING` → `PROCESSING` → `SUCCESS` / `DENIED`.
   - UI automatically polls every 3 seconds until a terminal state is reached.
3. **Transaction Search & History Sync (`GET /v1/reporting/transactions`):**
   - Syncs historical disbursements over a 90-day window, chunking into 31-day intervals to adhere to PayPal Reporting API constraints.
   - Recomputes vendor median amounts and builds local payee baselines. Gracefully falls back to local history if disabled.
4. **Webhook Signature Verification (`POST /v1/notifications/verify-webhook-signature`):**
   - Validates incoming PayPal webhook events (`PAYMENT.PAYOUTSBATCH.SUCCESS`) against PayPal's verification certificate endpoint.
5. **Built-in Mock Client:**
   - Full in-memory stateful simulation of all PayPal endpoints for offline development and instant hackathon demonstrations.

---

## 🤖 Exactly How AI is Used

1. **Structured Invoice Extraction (Google Gemini 2.5 Flash):**
   - System prompt treats all email text strictly as **untrusted data**, preventing prompt injection.
   - Enforces structured JSON output schema: `vendorName`, `paymentRequested`, `payeeChangeRequested`, `payeeChangeMentioned`, `newPayeeIdentifiers`, `amount`, `currency`, `tactics` (urgency, secrecy, authority, avoid_phone), `channelShift`, `giftCards`, `phonesInEmail`.
   - Runs with `temperature: 0`, 30s timeout, and 1 automated retry. Works across any language (English, Spanish, French, German, Portuguese, etc.).
2. **Independent Second Opinion Judge:**
   - A separate, decoupled Gemini call evaluates the email independently, returning `{ verdict: HOLD|CHECK|CLEAR, reason }`. It can add security flags, but can never dismiss flags raised by the deterministic engine.
3. **Deterministic Fallback Reader:**
   - If no `GEMINI_API_KEY` is provided, PayGuard automatically runs in fallback mode using its keyword and regex extraction engine.
   - **Safety Invariant:** The fallback reader *never* returns a bare `CLEAR` for an email requesting money; it always returns `CHECK` to demand human verification.

---

## 🛡️ The 16-Rule Deterministic Checklist

| Rule ID | Severity | Description |
| :--- | :--- | :--- |
| `bank_change` / `payee_change` | **HIGH** | Explicit request to change payee account, routing number, or IBAN |
| `lookalike_domain` | **HIGH** | Levenshtein typosquatting, homoglyphs (e.g. 0 for o), swapped TLDs (.co), hyphen tricks |
| `reply_to_mismatch` | **HIGH** | `From:` domain routes responses to an external unlisted `Reply-To:` address |
| `gift_cards` | **HIGH** | Untraceable currency requests (Apple gift cards, Steam cards, Bitcoin, USDT) |
| `auth_fail` | **HIGH** | SPF, DKIM, or DMARC failures detected in `Authentication-Results` headers |
| `new_payee_identifier` | **HIGH** | Email requests payment to a PayPal account never paid before |
| `payee_change_notice` | **MEDIUM** | Advance notice announcing future banking transition |
| `sender_not_on_file` | **MEDIUM** | Sender domain is not registered under the matched vendor record |
| `unknown_vendor` | **MEDIUM** | First-time requester with no prior transaction history |
| `free_mail_payment` | **MEDIUM** | Commercial vendor billing from free consumer webmail (Gmail, Yahoo, Outlook) |
| `subdomain_sender` | **MEDIUM** | Unusual nested multi-level subdomains masking true host |
| `amount_anomaly` | **MEDIUM** | Requested amount exceeds 3x the vendor's historical median payout |
| `pressure` | **MEDIUM** | Social engineering tactics (artificial deadlines, secrecy, executive authority) |
| `channel_shift` | **MEDIUM** | Requesting communication shift to WhatsApp, Telegram, or personal SMS |
| `model_judgement` | **HIGH/MED** | Independent Gemini second opinion flagged the correspondence |
| `no_ai_reader` | **MEDIUM** | Cautious fallback mode flag mandating verification |

---

## 🧪 Evaluation Benchmark Results

We evaluated PayGuard Agent against a synthetic test suite of 40 original labeled emails (`data/eval/emails.jsonl`), including 20 fraud scenarios (multilingual BEC, homoglyphs, reply-to hijacking, gift cards) and 20 honest scenarios (routine cloud bills, office supplies, freight invoices):

```
======================================================
              PAYGUARD EVALUATION SUMMARY             
======================================================
Total Emails Tested:           40
Reader Mode:                   Deterministic Fallback
Frauds Caught & Held:          16 / 20 (80.0%)
Frauds Missed:                 0 (100% of remaining caught as CHECK)
Honest Invoices Interrupted:   0 / 20 (False Positive Rate: 0.0%)
Honest Invoices Processed:     20 / 20
Verdict Breakdown:             HOLD: 16 | CHECK: 17 | CLEAR: 7
======================================================
```

> **Honest Disclaimer on Evaluation:** This dataset is author-written, synthetic, and relatively small (40 emails). While it demonstrates that high-risk payee redirections and lookalike domains are reliably intercepted without false-positive interruptions on routine invoices, real-world BEC attacks can exhibit greater stylistic diversity.

---

## ⚙️ Environment Configuration

Copy `.env.example` to `.env`:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Server listening port | `3000` |
| `NODE_ENV` | Application environment (`development` or `production`) | `development` |
| `APP_PASSWORD` | Master password for dashboard authentication | `payguard2026!` |
| `SESSION_SECRET` | Secret key used for signing session cookies | *(change in prod)* |
| `PAYPAL_MODE` | PayPal integration mode: `mock` or `sandbox` | `mock` |
| `PAYPAL_CLIENT_ID` | PayPal Sandbox Client ID | `""` |
| `PAYPAL_CLIENT_SECRET` | PayPal Sandbox Client Secret | `""` |
| `PAYPAL_WEBHOOK_ID` | Optional PayPal Webhook ID for signature verification | `""` |
| `GEMINI_API_KEY` | Google Gemini API key (if unset, uses fallback reader) | `""` |
| `GEMINI_MODEL` | Google Gemini model ID | `gemini-2.5-flash` |
| `APPROVAL_LIMIT` | Amount ($) requiring explicit typed amount confirmation | `500` |
| `HARD_LIMIT` | Hard threshold ($) above which in-app payouts are blocked | `5000` |
| `DB_PATH` | Path to SQLite database file | `./data/payguard.db` |
| `SEED_RECIPIENTS` | Comma-separated sandbox buyer emails for real test payouts | `""` |

---

## 🚀 Running Locally & Switching to Sandbox

### Mock Mode (Zero Credentials)
```bash
npm install
npm run seed
npm run build
npm start
```

### Switching to Real PayPal Sandbox
1. Set in your `.env`:
   ```ini
   PAYPAL_MODE=sandbox
   PAYPAL_CLIENT_ID=your_sandbox_client_id
   PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
   SEED_RECIPIENTS=sb-buyer@personal.example.com
   ```
2. Verify credentials with the sandbox smoke test script:
   ```bash
   npm run smoke:sandbox
   ```
3. Run `npm start` to execute live Sandbox Payouts.

---

## ⚠️ Known Limitations & Out-of-Scope

1. **Email Attachments:** PayGuard analyzes email headers and body text. Parsing attached PDFs or scanned TIFF invoices via OCR is not implemented in this prototype.
2. **Credential Phishing:** PayGuard protects against payment redirection and unauthorized vendor payouts. General credential phishing (e.g. fake Microsoft 365 login portals) is out of scope.
3. **Sandbox Reporting Delay:** PayPal Sandbox transaction reporting (`/v1/reporting/transactions`) can take hours to index newly sent payouts or may require specific permissions. PayGuard gracefully falls back to its local SQLite ledger without crashing.

---

## 👥 Authors & Acknowledgments

- **Author:** PayGuard Agent Team
- **License:** MIT License
- **Note:** AI coding assistants (Gemini, Claude, Antigravity) were utilized as pair programmers to accelerate implementation, generate evaluation test cases, and refine test coverage.
