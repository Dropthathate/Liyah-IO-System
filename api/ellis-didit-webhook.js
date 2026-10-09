import { createHmac, timingSafeEqual } from 'node:crypto';

const PRACTICE_SLUG = 'ellis-restorative-therapies';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const STORE_TIMEOUT_MS = 3800;

const STATUS_KEYS = new Map([
  ['Approved', 'approved'],
  ['Declined', 'declined'],
  ['In Review', 'in_review'],
  ['In Progress', 'in_progress'],
  ['Not Started', 'not_started'],
  ['Abandoned', 'abandoned'],
  ['Expired', 'expired'],
  ['Kyc Expired', 'kyc_expired'],
  ['Resubmitted', 'resubmitted'],
  ['Awaiting User', 'awaiting_user'],
]);

function respond(res, status, payload) {
  return res.status(status).json(payload);
}

function header(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseBody(body) {
  if (typeof body === 'string') return JSON.parse(body);
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8'));
  return body;
}

function requestBodyBytes(body) {
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  if (Buffer.isBuffer(body)) return body.length;
  if (body === undefined || body === null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Didit V2: recursively sorted keys, compact JSON, and unescaped Unicode. */
export function canonicalizeDidit(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeDidit).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeDidit(value[key])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Unsupported value in Didit payload.');
  return encoded;
}

export function verifySignatureV2(payload, signatureHeader, timestampHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== 'string' || secret.length === 0) return false;
  const timestampText = String(timestampHeader ?? '');
  if (!/^\d{9,11}$/.test(timestampText)) return false;
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;

  const signatureMatch = String(signatureHeader ?? '').match(/^(?:sha256=)?([0-9a-f]{64})$/i);
  if (!signatureMatch) return false;

  let canonical;
  try {
    canonical = canonicalizeDidit(payload);
  } catch {
    return false;
  }

  const expected = createHmac('sha256', secret).update(canonical, 'utf8').digest();
  const received = Buffer.from(signatureMatch[1], 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function mapDiditStatus(status) {
  return STATUS_KEYS.get(status) ?? null;
}

export function parseEllisBookingReference(vendorData) {
  if (typeof vendorData !== 'string') return null;
  const match = vendorData.match(new RegExp(`^${PRACTICE_SLUG}:(${UUID_PATTERN.source.slice(1, -1)})$`, 'i'));
  return match?.[1] ?? null;
}

export function validateEllisStatusEvent(payload, expectedWorkflowId, expectedEnvironment) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'invalid_payload' };
  if (payload.webhook_type !== 'status.updated') return { ok: true, ignored: true };
  if (!UUID_PATTERN.test(String(payload.event_id ?? '')) || !UUID_PATTERN.test(String(payload.session_id ?? ''))) {
    return { ok: false, reason: 'invalid_event_or_session_id' };
  }
  if (!UUID_PATTERN.test(String(payload.workflow_id ?? '')) || payload.workflow_id.toLowerCase() !== expectedWorkflowId.toLowerCase()) {
    return { ok: false, reason: 'workflow_mismatch' };
  }
  if (payload.environment !== expectedEnvironment) return { ok: false, reason: 'environment_mismatch' };
  if (!Number.isSafeInteger(payload.timestamp) || payload.timestamp <= 0) return { ok: false, reason: 'invalid_event_timestamp' };

  const statusKey = mapDiditStatus(payload.status);
  if (!statusKey) return { ok: false, reason: 'unsupported_status' };

  const bookingReference = parseEllisBookingReference(payload.vendor_data);
  if (!bookingReference) return { ok: false, reason: 'booking_reference_mismatch' };

  return {
    ok: true,
    record: {
      eventId: payload.event_id,
      sessionId: payload.session_id,
      bookingReference,
      workflowId: payload.workflow_id,
      environment: payload.environment,
      status: payload.status,
      statusKey,
      eventTimestamp: payload.timestamp,
      createdAt: Number.isSafeInteger(payload.created_at) ? payload.created_at : null,
    },
  };
}

function isAppsScriptExecUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'script.google.com'
      && url.pathname.startsWith('/macros/s/')
      && url.pathname.endsWith('/exec')
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: 'Method not allowed.' });
  }

  const secret = process.env.DIDIT_ELLIS_WEBHOOK_SECRET?.trim();
  const workflowId = process.env.DIDIT_ELLIS_WORKFLOW_ID?.trim();
  const environment = process.env.DIDIT_ELLIS_ENVIRONMENT?.trim().toLowerCase();
  if (!secret || !workflowId || !UUID_PATTERN.test(workflowId) || !['live', 'sandbox'].includes(environment)) {
    return respond(res, 503, { error: 'Ellis verification webhook is not configured.' });
  }

  const declaredLength = Number(header(req, 'content-length'));
  if ((Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) || requestBodyBytes(req.body) > MAX_BODY_BYTES) {
    return respond(res, 413, { error: 'Webhook body is too large.' });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(String(header(req, 'content-type') ?? ''))) {
    return respond(res, 415, { error: 'Content-Type must be application/json.' });
  }

  let payload;
  try {
    payload = parseBody(req.body);
  } catch {
    return respond(res, 400, { error: 'Invalid JSON body.' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return respond(res, 400, { error: 'Invalid webhook envelope.' });
  }

  const timestamp = header(req, 'x-timestamp');
  const signature = header(req, 'x-signature-v2');
  if (!verifySignatureV2(payload, signature, timestamp, secret)) {
    return respond(res, 401, { error: 'Webhook signature or timestamp is invalid.' });
  }

  // Didit V3's signed body timestamp and X-Timestamp both represent dispatch
  // time and are refreshed together on retries. Bind them to block replay by
  // replacing only the unsigned header on an otherwise valid old event.
  if (!Number.isSafeInteger(payload.timestamp) || payload.timestamp !== Number(timestamp)) {
    return respond(res, 401, { error: 'Webhook signature or timestamp is invalid.' });
  }

  const event = validateEllisStatusEvent(payload, workflowId, environment);
  if (event.ignored) return respond(res, 202, { received: true, ignored: true });
  if (!event.ok) {
    if (event.reason === 'workflow_mismatch' || event.reason === 'environment_mismatch') {
      console.warn('Ellis Didit event rejected for configured workflow/environment mismatch.');
    }
    const status = event.reason === 'workflow_mismatch' || event.reason === 'environment_mismatch' ? 403 : 400;
    return respond(res, status, { error: 'Webhook does not match the configured Ellis verification flow.' });
  }

  const storeUrl = process.env.DIDIT_ELLIS_RESULT_STORE_URL?.trim();
  const storeToken = process.env.ELLIS_DIDIT_RESULT_STORE_TOKEN;
  if (!storeUrl || !isAppsScriptExecUrl(storeUrl) || !storeToken || Buffer.byteLength(storeToken, 'utf8') < 32) {
    return respond(res, 503, { error: 'Ellis verification result storage is not configured.' });
  }

  // Only the approved, minimal allowlist is sent to the practice-owned store.
  // The signed decision object, ID fields/images, names, and health/intake data are discarded.
  const storePayload = {
    token: storeToken,
    outcome: event.record,
  };

  try {
    const storeResponse = await fetch(storeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(storePayload),
      signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
    if (!storeResponse.ok) {
      console.error('Ellis Didit result store returned a non-success status.');
      return respond(res, 503, { error: 'Could not persist the verification result.' });
    }

    let storeResult;
    try {
      storeResult = await storeResponse.json();
    } catch {
      console.error('Ellis Didit result store returned an invalid response.');
      return respond(res, 503, { error: 'Could not persist the verification result.' });
    }
    if (storeResult?.ok !== true) {
      console.error('Ellis Didit result store rejected the status record.');
      return respond(res, 503, { error: 'Could not persist the verification result.' });
    }

    return respond(res, 200, { received: true, duplicate: storeResult.duplicate === true });
  } catch {
    console.error('Ellis Didit result store request failed or timed out.');
    return respond(res, 503, { error: 'Could not persist the verification result.' });
  }
}
