# PayGuard Agent — Video Demo Script (2:40)

> **Hackathon Submission:** PayPal AI Hackathon — Best Use of Agentic Commerce  
> **Target Duration:** Exactly 2 minutes and 40 seconds (160 seconds)  
> **Key Story Arc:** A small business bookkeeper faces a sophisticated Business Email Compromise (BEC) attack, PayGuard intercepts and holds the fraud, the bookkeeper rejects it with out-of-band verification, and an honest invoice is safely paid via PayPal Payouts reaching `PAID`.

---

## Shot-by-Shot Timeline

### 0:00 - 0:25: The Problem & Opening Hook (25s)
- **Visual:** Speaker on camera + Title card with tagline:  
  *“PayGuard Agent: An AI agent that checks payment-request emails against your PayPal payment history, holds anything suspicious, and only sends money after a human approves.”*
- **Voiceover:**  
  *“Business Email Compromise costs small businesses billions every year. An attacker compromises an authentic vendor inbox, emails ‘we changed our banking details, please pay today’, and busy bookkeepers pay without a second check. Today, we built PayGuard Agent—an autonomous guardian that pairs Google Gemini AI with PayPal Payouts to eliminate payment fraud while streamlining routine vendor commerce.”*

---

### 0:25 - 0:50: The Dashboard & Ground Truth Directory (25s)
- **Visual:** Screen recording of PayGuard Dashboard (`http://localhost:3000`). Show stats cards (Pending Review, Suspicious Emails Held, Paid Volume), and the **PayPal Mode** and **AI Mode** status banners. Click into the **Vendors** tab.
- **Voiceover:**  
  *“Here’s the PayGuard dashboard. PayGuard connects directly to PayPal to sync historical disbursements and verified payee addresses. Notice the vendors directory: each vendor record maintains ground-truth PayPal emails, authorized domains, typical payout amounts, and an independently verified phone number from initial contracts.”*

---

### 0:50 - 1:35: Intercepting Fraud: The Phishing Payee Change (45s)
- **Visual:** Navigate to **Check Email**. Click on the demo chip: **“🚨 Fraud: New Payee”**. Show the raw email: *“Our bank is under annual audit... remit $450 to alice-payouts-temp@fastmail.com”*. Click **“Check This Email”**.
- **Visual Highlights:**
  1. Instant transition to Big Red Banner: **`VERDICT: HOLD`**.
  2. Flags section: Highlight **Payee or Bank Account Change Requested** (HIGH) and **Unrecognized Payee Account in Email** (HIGH).
  3. Show the **Payment Proposal Card**: Note that even though the email requested `fastmail.com`, the agent locked the payee strictly to the verified address on file: `billing@reliablecloud.com`.
  4. Show the **Out-of-Band Callback Script**: Notice the phone number `+1-555-0199` comes exclusively from internal records, never the email.
- **Voiceover:**  
  *“Let’s test an attacker attempting an invoice redirection. The email claims the vendor’s bank is under audit and asks for payment to a temporary fastmail address. We submit it. Boom—VERDICT: HOLD. PayGuard’s 16-rule engine combined with Gemini 2.5 Flash flags the payee change immediately. Notice our hard invariant: the proposal locks payment strictly to the address on file, and provides an out-of-band callback script using only the trusted phone number from our internal records.”*
- **Visual Action:** Click **Proceed to Proposal Review**. Click **Reject Proposal**, enter reason *“Confirmed BEC fraud with vendor CFO”*, and show proposal updated to **REJECTED** in the audit log.

---

### 1:35 - 2:20: The Safe Path: Honest Invoice & PayPal Payout (45s)
- **Visual:** Return to **Check Email**. Click on the demo chip: **“✓ Honest: Cloud Invoice”** (Monthly invoice for $450.00 from `Reliable Cloud Inc`). Click **“Check This Email”**.
- **Visual Highlights:**
  1. Big Green Banner: **`VERDICT: CLEAR`**.
  2. Zero flags detected. Matching vendor and median amount confirmed.
  3. Click **Proceed to Proposal Review & Approval**.
  4. Proposal shows status `PENDING_REVIEW`. Click **“✓ Approve & Send Payout”**.
  5. Status updates to `PAYING (PayPal)`. The app polls the PayPal Payouts API.
  6. Within 3 seconds, status turns green: **`PAID`** with PayPal Batch ID visible.
- **Voiceover:**  
  *“Now let’s look at honest, day-to-day operations. Here’s a legitimate recurring cloud infrastructure bill from Reliable Cloud Inc. PayGuard checks the sender domain, matches the vendor, verifies the PayPal payee, and evaluates historical payment frequency. Verdict: CLEAR. PayGuard creates a payment proposal. As a human, I click Approve. The agent calls PayPal Payouts with an idempotent batch ID. The API executes the payment, tracks it through polling, and registers the transaction as PAID.”*

---

### 2:20 - 2:40: Audit Trail & Wrap-up (20s)
- **Visual:** Navigate to **Audit Trail**. Show the immutable, append-only log detailing every check, rule flag, human note, and PayPal batch ID. Click **Export CSV**.
- **Voiceover:**  
  *“Every decision, flag, and PayPal batch response is recorded in an append-only audit trail ready for compliance export. PayGuard operates in both full zero-credential Mock mode and real PayPal Sandbox. Small businesses no longer have to choose between fast payments and fraud security. PayGuard gives them both. Thank you!”*
