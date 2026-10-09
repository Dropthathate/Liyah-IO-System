# Ellis Didit V3 webhook setup

This receiver is specific to **Ellis Restorative Therapies**. It complements `api/ellis-didit-session.js`, which starts a hosted Didit V3 session from an opaque UUID booking reference. The webhook verifies a signed Didit status event and forwards only an allowlisted status record to a practice-owned Google Sheet.

## Important boundary

A Didit `Approved` result means Didit approved the configured identity-verification workflow. **It does not by itself accept the appointment or prove that the verified name matches the booking name.** This implementation intentionally discards the signed `decision` object and does not store or compare identity names. It also does not durably bind the Didit `session_id` to an authoritative Ellis booking record. The current Sheet is a status ledger only; the practice must review the outcome and make the booking decision under its own written policy. Before automating a booking decision or name match, a trusted booking backend must durably bind `{bookingReference, sessionId, workflowId, environment}`, look up the actual booking, apply an allowed transition atomically, and compare names transiently. Do not advertise automatic name matching or booking acceptance until that is implemented and tested.

This booking-specific integration also does not implement SomaSync-wide, one-time therapist verification. That platform feature belongs in the separate `c-bot` repository, which was not selected for this task.

## Files and URLs

- Session creation: `POST https://leah.somasyncai.com/api/ellis-didit-session` — server-side caller only; requires `Authorization: Bearer <ELLIS_DIDIT_REQUEST_TOKEN>` and JSON `{ "bookingReference": "<UUID>" }`.
- Didit webhook destination: `POST https://leah.somasyncai.com/api/ellis-didit-webhook` — server-to-server callback; subscribe only to `status.updated`, version `v3`.
- Browser return URL: `https://leah.somasyncai.com/verification-return.html` — neutral user-facing completion page. It is **not** the webhook and never trusts URL parameters as verification results.
- Practice-owned store: deploy `backend/ellis-didit-result-store.gs` as an Apps Script web app attached to a dedicated Sheet. The Sheet receives status metadata only.

## 1. Prepare the Google Sheet and Apps Script store

1. Create a new Google Sheet controlled by the practice owner. Use it only for Didit event metadata; do not place ID scans, verified names, or health/intake data in it.
2. In Apps Script, create a standalone project or a script attached to that Sheet and paste the complete contents of `backend/ellis-didit-result-store.gs` into the script editor.
3. In **Project Settings → Script Properties**, add:
   - `ELLIS_DIDIT_STORE_TOKEN`: a new random secret with at least 32 bytes. Generate one with `openssl rand -hex 32`; use the same value in Vercel and Apps Script.
   - `ELLIS_DIDIT_SPREADSHEET_ID`: the spreadsheet ID from the Sheet URL.
   - Optional `ELLIS_DIDIT_SHEET_NAME`: defaults to `DIDIT_VERIFICATION_EVENTS`.
4. Save the script and deploy it as a **Web app** that executes as the owner. The app must be reachable by Vercel without Google login, so choose the public access option available to the account and rely on the long shared token for write authorization. The token is never sent to the browser. Do not put it in the Apps Script source or a Sheet cell.
5. Copy the deployed URL ending in `/exec`. The receiver accepts only an HTTPS Apps Script web-app URL under `script.google.com/macros/s/.../exec`.

The store uses an append-only event log and deduplicates retries by Didit's stable `event_id`. Its current Apps Script implementation uses a global script lock and scans the event-ID column; **treat it as a low-volume, single-practice pilot ledger only**. Didit retries a `5xx` at most twice and then drops the delivery. Monitor the Didit **Deliveries** tab, reconcile missed events manually, and replace the scan/append path with a durable indexed store plus delivery-failure alerting before scaling or using this for multi-practice traffic. If the Script Properties, access scope, or Sheet schema is wrong, the store returns a machine-readable error and the Didit endpoint responds with 503 so Didit can retry.

The booking reference, session ID, and verification status are linkable personal data even though the ledger omits identity documents and names. Before any live use, the practice owner must define an applicable notice/consent basis, retention and deletion schedule, incident procedure, and minimum access: keep the Sheet, Apps Script project, and Script Properties owner-controlled; limit and periodically review editor access. Do not call the ledger anonymous or assume that omitting ID images removes privacy obligations.

## 2. Set Vercel environment variables

Add these variables to the Vercel project for the intended deployment environment; keep them server-side only. Use **Preview** and **Production** values deliberately—never point a sandbox Didit workflow at live booking data.

| Variable | Value |
|---|---|
| `DIDIT_API_KEY` | Didit API key used by the existing session-creation function. Rotate the key previously pasted into chat before using it. |
| `DIDIT_ELLIS_WORKFLOW_ID` | UUID for the exact Ellis workflow in Didit. |
| `ELLIS_DIDIT_REQUEST_TOKEN` | High-entropy caller token required by the existing session-creation endpoint. |
| `DIDIT_ELLIS_CALLBACK_URL` | `https://leah.somasyncai.com/verification-return.html` (or the matching preview URL during testing). |
| `DIDIT_ELLIS_CUSTOM_DOMAIN` | Optional verified Didit hosted-verification domain if one is configured. |
| `DIDIT_ELLIS_WEBHOOK_SECRET` | Didit's `secret_shared_key` for this webhook destination. |
| `DIDIT_ELLIS_ENVIRONMENT` | Exactly `sandbox` or `live`, matching the separate Didit application's mode, API key, and workflow for this Vercel environment. This is an operator-set assertion, not a provider-side mode check. |
| `DIDIT_ELLIS_RESULT_STORE_URL` | Deployed Apps Script web-app URL ending `/exec`. |
| `ELLIS_DIDIT_RESULT_STORE_TOKEN` | Same random token as the Apps Script `ELLIS_DIDIT_STORE_TOKEN` property. |

After changing serverless environment variables, redeploy the Vercel project. The source `.env.example` contains names only; never commit a real `.env` file.

## 3. Create the Didit V3 destination

1. In Didit's Business Console, open **API & Webhooks** and create a destination with URL `https://leah.somasyncai.com/api/ellis-didit-webhook` (or the active Preview URL for a sandbox test).
2. Set `webhook_version` to `v3`; subscribe only to the exact event `status.updated`.
3. Copy the destination's `secret_shared_key` directly to `DIDIT_ELLIS_WEBHOOK_SECRET` in Vercel. The secret is scoped to this destination; it is not the Didit API key.
4. Keep the browser callback URL separate: the callback returns the person to the website, while the webhook is the signed server-to-server result channel.

The receiver accepts only the configured `workflow_id`, configured `live`/`sandbox` environment, recognized V3 statuses, and `vendor_data` matching `ellis-restorative-therapies:<booking-UUID>`. `vendor_data` is generated by the session function; it must not contain names, phone numbers, email addresses, or clinical details.

## 4. Test before live bookings

1. Deploy the Apps Script and Vercel Preview configuration with Didit's **sandbox** environment and a sandbox workflow.
   Use only synthetic identities or Didit's designated test media in sandbox. Sandbox verification still processes uploaded images/biometrics and may retain them under Didit's retention controls; never submit an actual client's ID/photo or health/intake data for this test. Confirm the current retention terms in the Didit account.
2. Use Didit's **Try Webhook** for `status.updated`. Ensure the test payload's `workflow_id`, `environment`, and `vendor_data` satisfy the Ellis association. A generic test payload with a different vendor string is intentionally rejected. The signed body `timestamp` must exactly equal the `X-Timestamp` dispatch header.
3. Check the Didit Deliveries entry for HTTP 200 and the dedicated Sheet for one row containing event/session/workflow UUIDs, opaque booking reference, environment, status, and timestamps. Do not add the `decision` body to the Sheet or logs.
4. Replay the same delivery and confirm it does not create a second row. When constructing a test payload yourself, set both the signed body `timestamp` and `X-Timestamp` to the same current Unix time.
5. Test `Approved`, `Declined`, and `In Review`; these statuses are stored as workflow outcomes only. The practice must still decide whether to accept, decline, or manually review the appointment.
6. Only after sandbox validation, configure the live workflow/destination and live secrets, then run a controlled test that does not create a real client appointment.

Didit recommends `X-Signature-V2`: the server verifies HMAC-SHA256 over recursively sorted, compact JSON with Unicode preserved, compares in constant time, and rejects an `X-Timestamp` more than 300 seconds from receipt. Didit V3's signed body `timestamp` and `X-Timestamp` both represent dispatch time and are refreshed together on retries; the receiver requires them to match exactly so a captured old signed body cannot be replayed with only a rewritten header. Invalid 4xx responses are generally not retried by Didit; missing storage and store failures return 503, which Didit retries up to two times.

## 5. After activation

- Add authoritative booking/session binding and lookup before treating a verification status as an appointment decision. No client booking is automatically accepted or denied by this endpoint.
- The current Apps Script result log is an event ledger; the booking calendar/Sheet remains the booking source of truth. Do not write a booking acceptance flag until booking-name matching and the practice review policy are implemented.
- Before live use, document applicable notice/consent, retention/deletion, and incident procedures; limit Sheet/Apps Script editors to the practice owner and necessary operators, and review access periodically.
- Rotate the exposed Didit API key before enabling the live workflow.
- Cancel the clearly labeled Ellis test booking from October 7, 2026 at 5:00 PM in the calendar/booking Sheet after confirming it is still present; remove its `BOOKINGS` row only if it exists and corresponds to that test.
- Platform-level therapist verification remains a separate `c-bot` implementation task.
