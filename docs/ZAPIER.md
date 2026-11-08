# Automated Email Intake via Zapier & Webhooks

PayGuard Agent provides an intake webhook (`POST /api/intake/email`) enabling automated pipeline ingestion from email providers (Gmail, Outlook, Zendesk, etc.) via **Zapier** or custom webhooks.

> **Core Safety Invariant:** Automated intake **never executes payouts by itself**. It processes incoming emails, evaluates AI and deterministic security rules, scans attachments, records audit entries, and generates a structured payment proposal held in `PENDING_REVIEW` (or `BLOCKED` if high risk). Human approvers must verify and release payouts in the PayGuard web dashboard.

---

## 1. Prerequisites

1. Set `INTAKE_API_KEY` in your `.env` (or environment settings in Render):
   ```env
   INTAKE_API_KEY=your_secure_intake_key_here
   ```
   *Note: If `INTAKE_API_KEY` is not set or empty, the intake route is automatically disabled (HTTP 403).*
2. Ensure your PayGuard instance has a publicly accessible URL (e.g. `https://payguard-agent.onrender.com` or local tunnel via ngrok).

---

## 2. Step-by-Step Zapier Setup

### Step 1: Create a New Zap
1. Log in to [Zapier](https://zapier.com) and click **Create Zap**.
2. Name your Zap: `PayGuard Email Intake Pipeline`.

### Step 2: Configure the Trigger (Gmail or Outlook)
1. **App**: Select **Gmail** (or your corporate email provider).
2. **Event**: Select **New Email Matching Search** (or **New Email**).
3. **Account**: Connect your Accounts Payable / Billing mailbox.
4. **Trigger Setup**:
   - Search Query: `to:ap@company.com subject:(invoice OR payment OR bill)`
5. Test the trigger to pull in a recent email sample.

### Step 3: Configure the Webhook Action
1. **App**: Select **Webhooks by Zapier**.
2. **Event**: Select **Custom Request** (or **POST**).
3. **Action Setup**:
   - **Method**: `POST`
   - **URL**: `https://your-payguard-domain.onrender.com/api/intake/email`
   - **Data** (JSON):
     ```json
     {
       "from": "{{From Email}}",
       "to": "{{To Email}}",
       "subject": "{{Subject}}",
       "body": "{{Body Plain}}",
       "messageId": "{{Message ID}}"
     }
     ```
   - **Headers**:
     - `Content-Type`: `application/json`
     - `X-Intake-Key`: `your_secure_intake_key_here`

### Step 4: Test & Activate
1. Click **Test Step** in Zapier.
2. Verify that PayGuard responds with HTTP 200 and returns a JSON payload containing the verdict, security flags, proposal ID, and approval URL.
3. Turn on the Zap.

---

## 3. Testing with cURL

You can test the endpoint locally or against your deployed service with `curl`:

```bash
curl -X POST http://localhost:3000/api/intake/email \
  -H "Content-Type: application/json" \
  -H "X-Intake-Key: your_secure_intake_key_here" \
  -d '{
    "from": "billing@reliablecloud.com",
    "to": "ap@mycompany.com",
    "subject": "Invoice #RC-9021 for Cloud Hosting",
    "body": "Hello team, please find attached the monthly invoice for $450.00 USD. Remit payment to our authorized account: billing@reliablecloud.com.",
    "messageId": "gmail_msg_18b939fa92b"
  }'
```

### Response Example:
```json
{
  "verdict": "CLEAR",
  "flags": [],
  "proposalId": "prop_a71e3b092f14",
  "url": "http://localhost:3000/proposals/prop_a71e3b092f14"
}
```

If the email contains suspicious payee redirections or lookalike domains:
```json
{
  "verdict": "HOLD",
  "flags": [
    {
      "id": "payee_change",
      "severity": "HIGH",
      "title": "Payee Bank/Account Redirection Claim",
      "evidence": "Attacker claims banking details updated to attacker@fraud.com"
    }
  ],
  "proposalId": "prop_89b2c3d4e5f6",
  "url": "http://localhost:3000/proposals/prop_89b2c3d4e5f6"
}
```

---

## 4. Features & Safeguards

- **Timing-Safe Key Comparison:** The `X-Intake-Key` header is checked using `crypto.timingSafeEqual` to prevent timing attacks.
- **Message Idempotency:** The `messageId` field guarantees idempotent processing. Sending the same email twice returns the existing proposal and verdict instantly without duplicating database records or re-running checks.
- **Payload Limits:** The `/api/intake/email` route supports payloads and base64/multipart attachments up to **8 MB**, whereas standard API routes remain restricted to 100 KB.
- **Source Auditing:** Proposals created via intake are tagged with `source: zapier_intake` and highlighted in both the Dashboard and the Proposal Detail view.

---

## 5. Testing & Verification Note

> **Honest Verification Statement:** The intake pipeline has been verified through comprehensive automated test suites (`tests/api/intake.test.ts`), validating authentication security, constant-time comparisons, rate limiting, message deduplication, and attachment handling. Connecting to live third-party Zapier triggers in a production workflow requires a publicly routable HTTPS webhook URL.
