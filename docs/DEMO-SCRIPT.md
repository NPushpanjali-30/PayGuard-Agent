# PayGuard Agent — Video Demo Script (2:40)

> **Hackathon Submission:** PayPal AI Hackathon — Best Use of Agentic Commerce  
> **Target Duration:** Exactly 2 minutes and 40 seconds (160 seconds)  
> **Key Story Arc:** A sophisticated invoice PDF fraud attempt is caught, out-of-band vendor confirmation is DENIED and auto-blocked; a high-value honest invoice requires dual approval before triggering a live PayPal Sandbox payout to `PAID`; and MCP + Zapier integration highlights seamless agentic commerce.

---

## Shot-by-Shot Timeline

### 0:00 - 0:20: The Threat & Platform Intro (20s)
- **Visual:** Presenter on camera + Title card:  
  *“PayGuard Agent: An AI agent that checks payment-request emails & invoice attachments against your PayPal payment history, holds anything suspicious, and only sends money after humans approve.”*
- **Voiceover:**  
  *“Business Email Compromise and invoice redirection fraud steal billions from small businesses each year. Attackers now embed altered banking details directly inside attached PDF invoices, slipping past basic email filters. We built PayGuard Agent—an autonomous guardian that pairs Google Gemini multimodal AI with PayPal Payouts to catch fraudulent invoices, mandate out-of-band verification, and streamline authorized commerce.”*

---

### 0:20 - 0:55: Fraud PDF Caught & Vendor Confirmation DENIED (35s)
- **Visual:** Navigate to **Check Email** page.
  1. Click **“Try Sample PDF”** -> Select **“🚨 Fraud: Mismatched PDF Invoice”**.
  2. Show email body (looks authentic from Reliable Cloud) and attached `sample-fraud-invoice.pdf`.
  3. Click **“Check This Email & Attachments”**.
  4. Red banner triggers: **`VERDICT: HOLD`**.
  5. Show **Side-by-Side Comparison Table**: Extracted PDF payee (`evil-hacker-drop@scam-mail.org`) highlighted in red next to verified vendor payee on file (`billing@reliablecloud.com`).
  6. Click **“Send confirmation to vendor contact on file”**. Confirmation sent to `billing-contact@reliablecloud.com`.
  7. Open the public token link (`/confirm/:token`) in an incognito window. Click **“✕ No, I did not send this request”** (`DENIED`).
  8. Back in proposal view: Proposal is automatically updated to **`BLOCKED`**.
  9. Approver clicks **Reject**, keeping the default checkboxes checked: **“Block this sender domain”** and **“Block these payee identifiers”**.
- **Voiceover:**  
  *“Watch PayGuard intercept a sophisticated attack. Here, the email text looks completely normal, but the attached PDF invoice quietly substitutes an attacker’s PayPal address. PayGuard reads the PDF with Gemini multimodal vision, detects the payee mismatch against verified vendor records, and forces an immediate HOLD. The approver sends an out-of-band cryptographic confirmation to the vendor's verified contact. When the vendor clicks ‘No, I did not send this’, PayGuard auto-blocks the proposal and allows the approver to block the attacker's infrastructure with one click.”*

---

### 0:55 - 1:40: Two-Person Approval on Large Honest Invoice & Sandbox Payout (45s)
- **Visual:**
  1. Switch to **Check Email** and load **“✓ Honest: Container Freight Invoice ($1,200.00)”**.
  2. Click **“Check This Email”** -> Green Banner: **`VERDICT: CLEAR`**.
  3. Click **Proceed to Proposal Review**.
  4. Highlight the **Dual Approval Required (0/2)** badge: because amount ($1,200.00) exceeds the $1,000 threshold.
  5. Current logged-in user **Alice** clicks **“✓ Provide 1st Approval (1/2)”**. Badge updates to `1/2` and notes Alice's approval.
  6. Alice tries clicking again: rejected with tooltip *“Second approval must come from a different logged-in user”*.
  7. Click Logout -> Log in as **Bob** (`bob:password2`).
  8. Bob opens proposal #prop_xyz. The button now reads **“✓ Provide 2nd Approval & Send Payout (2/2)”**.
  9. Bob clicks Approve. Status turns to `PAYING (PayPal)`.
  10. PayGuard calls PayPal Sandbox Payouts API (`POST /v1/payments/payouts`) with idempotent batch key. Status polls and switches to bright green: **`PAID`** with PayPal Batch ID visible.
- **Voiceover:**  
  *“Now, an honest high-value invoice. Global Logistics bills $1,200 for freight. All details match records, giving a CLEAR verdict. But because it exceeds our $1,000 dual-approval threshold, two distinct approvers are required. Alice provides the first approval, bringing progress to 1/2. PayGuard strictly prevents Alice from approving twice. Bob logs in, reviews the invoice, and provides the second approval. Instantly, PayGuard triggers the PayPal Payouts API in Sandbox mode, tracks execution, and logs the transaction as PAID.”*

---

### 1:40 - 2:15: Agentic Commerce Ecosystem: Zapier Intake & MCP Server (35s)
- **Visual:**
  1. Show **Zapier Webhook Intake**: Display code / curl sending an email payload to `POST /api/intake/email` with header `X-Intake-Key`. Show the proposal appearing on the dashboard with badge `Source: Zapier/Intake`.
  2. Show **Model Context Protocol (MCP)**:
     - Terminal running `npm run mcp`.
     - In Claude Desktop or Cursor: The agent calls `payguard_check_email` and `payguard_request_payment`.
     - Tool description highlighted on screen: *“PayGuard creates a proposal for human review. ONLY humans approve and execute payouts in the PayGuard web interface.”*
- **Voiceover:**  
  *“PayGuard is built for modern agentic commerce. Through our Zapier webhook intake, any incoming email in Gmail or Outlook is analyzed automatically. Even more powerful: PayGuard exposes a Model Context Protocol (MCP) server. Any external AI agent—in Claude Desktop, Cursor, or an enterprise workflow—can consult PayGuard to verify an email or queue a payment proposal. But by strict architectural design, external agents can never authorize payouts—only verified humans approve in the PayGuard UI.”*

---

### 2:15 - 2:40: Threat Learning & Audit Trail Wrap-Up (25s)
- **Visual:**
  1. Click into **Blocklist**: Show the attacker domain and payee handle dynamically learned from the earlier rejected proposal, with full audit trail links and verified vendor immunity.
  2. Click into **Audit Trail**: Show the tamper-evident log capturing the PDF check, vendor denial, dual approvals, and PayPal Sandbox payout batch. Click **Export CSV**.
  3. Final screen: GitHub repo URL and live demo link.
- **Voiceover:**  
  *“Rejected fraud attempts immediately feed PayGuard’s learned blocklist, permanently protecting the organization from repeat attacks while safeguarding verified vendor relationships. Every check, confirmation, and PayPal payout is immutably logged for financial compliance. PayGuard Agent delivers the speed of autonomous agentic commerce with the rock-solid certainty of human-in-the-loop security. Thank you!”*
