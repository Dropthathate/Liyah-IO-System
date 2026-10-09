# Ellis Didit Session Endpoint

This is an **Ellis-only, server-to-server** Vercel Function at `POST /api/ellis-didit-session`. It creates a Didit hosted identity-verification session and returns only `sessionId` and `verificationUrl`.

## Before deployment

1. Revoke the API key previously pasted into chat and create a replacement. Never put the replacement in source code, a browser, a public issue, or this repository.
2. In Didit, create and publish an Ellis KYC workflow containing the identity checks you intend to use. Apply Ellis's white-label style to that workflow. Copy its workflow ID.
3. Deploy this repository to a Vercel project that serves the `/api` functions. GitHub Pages alone serves static files and will **not** execute this endpoint. The repository also has a GitHub Pages workflow; verify the actual Vercel project/domain before directing live bookings to this route.
4. Add these variables in the Vercel project's Environment Variables settings (Production and Preview as appropriate):
   - `DIDIT_API_KEY` — rotated Didit API key, kept server-side.
   - `DIDIT_ELLIS_WORKFLOW_ID` — the published Ellis workflow UUID.
   - `ELLIS_DIDIT_REQUEST_TOKEN` — a separate, randomly generated secret of at least 32 characters. Only trusted backend callers should know it.
   - `DIDIT_ELLIS_CALLBACK_URL` — HTTPS browser-return page, normally `https://leah.somasyncai.com/verification-return.html`.
   - `DIDIT_ELLIS_ENVIRONMENT` — exactly `sandbox` or `live`, matching the Didit application's mode and workflow in this Vercel environment.
   - `DIDIT_ELLIS_CUSTOM_DOMAIN` — optional hostname such as `verify.restorewithellis.com`, after the custom domain is configured in Didit and DNS is verified.
5. Redeploy after changing environment variables.

A blank variable-name template is in the repository root at `.env.example`. Do not make a real `.env` file part of a commit.

## Request contract

Call this function **from Ellis's trusted booking backend**, not browser JavaScript. It requires a bearer token and accepts only a UUID booking reference; names, email addresses, phone numbers, ID data, symptoms, and intake details are intentionally rejected/not sent to Didit.

```http
POST /api/ellis-didit-session
Authorization: Bearer <ELLIS_DIDIT_REQUEST_TOKEN>
Content-Type: application/json

{"bookingReference":"<opaque-booking-uuid>"}
```

Successful response:

```json
{"sessionId":"<Didit-session-id>","verificationUrl":"https://verify.didit.me/session/..."}
```

The booking backend may redirect the user to `verificationUrl`. The API key and request token must remain server-side. Do not trust query-string status from Didit's return URL as proof of approval.

Didit's V3 create-session response includes `workflow_id` and echoes the `vendor_data` supplied by this function. The endpoint checks those echoes against the configured workflow and opaque booking reference before returning a session URL. The mode is determined by the separate Didit application/API key: use a sandbox application's key in Preview and a live application's key in Production. `DIDIT_ELLIS_ENVIRONMENT` is an operator-set assertion; it does not independently discover or correct a mismatched API key.

## Not included yet

This function creates a Didit session; the companion `api/ellis-didit-webhook.js` verifies `status.updated` events and writes only an allowlisted status record to the Apps Script ledger. The current flow does **not** durably bind a session to an authoritative booking record, compare the booking name with Didit's verified name, or update Ellis's booking calendar. An `Approved` result is not appointment acceptance or proof of a name match. Keep the workflow at manual review until a trusted booking/session binding, documented practice decision policy, privacy/retention controls, credential rotation, and production deployment have been completed.
