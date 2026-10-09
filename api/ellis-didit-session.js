import { timingSafeEqual } from 'node:crypto';

const DIDIT_CREATE_SESSION_URL = 'https://verification.didit.me/v3/session/';
const PRACTICE_SLUG = 'ellis-restorative-therapies';
const MAX_BODY_BYTES = 2048;
const MIN_CALLER_TOKEN_BYTES = 32;
const BOOKING_REFERENCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respond(res, status, payload) {
  return res.status(status).json(payload);
}

function secretsMatch(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const candidateBytes = Buffer.from(candidate, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

function bodyByteLength(body) {
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  if (Buffer.isBuffer(body)) return body.length;
  if (body === undefined || body === null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function readJsonBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body);
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
  return req.body;
}

function isAllowedHostedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;

    const allowedHosts = new Set(['verify.didit.me']);
    const configuredDomain = process.env.DIDIT_ELLIS_CUSTOM_DOMAIN?.trim().toLowerCase();
    if (configuredDomain) {
      const hostname = configuredDomain.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
      if (hostname) allowedHosts.add(hostname);
    }

    return allowedHosts.has(url.hostname.toLowerCase());
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

  const apiKey = process.env.DIDIT_API_KEY;
  const workflowId = process.env.DIDIT_ELLIS_WORKFLOW_ID;
  const callerToken = process.env.ELLIS_DIDIT_REQUEST_TOKEN;
  const environment = process.env.DIDIT_ELLIS_ENVIRONMENT?.trim().toLowerCase();

  if (!apiKey || !workflowId || !callerToken || Buffer.byteLength(callerToken, 'utf8') < MIN_CALLER_TOKEN_BYTES
      || !['live', 'sandbox'].includes(environment)) {
    return respond(res, 503, { error: 'Ellis identity verification is not configured.' });
  }

  const authorization = req.headers?.authorization || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch || !secretsMatch(bearerMatch[1], callerToken)) {
    return respond(res, 401, { error: 'Unauthorized.' });
  }

  const declaredLength = Number(req.headers?.['content-length']);
  if ((Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) || bodyByteLength(req.body) > MAX_BODY_BYTES) {
    return respond(res, 413, { error: 'Request body is too large.' });
  }

  const contentType = String(req.headers?.['content-type'] || '');
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return respond(res, 415, { error: 'Content-Type must be application/json.' });
  }

  let body;
  try {
    body = readJsonBody(req);
  } catch {
    return respond(res, 400, { error: 'Invalid JSON body.' });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return respond(res, 400, { error: 'A booking reference is required.' });
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'bookingReference') {
    return respond(res, 400, { error: 'Only an opaque bookingReference may be sent.' });
  }

  const bookingReference = body.bookingReference;
  if (typeof bookingReference !== 'string' || !BOOKING_REFERENCE_PATTERN.test(bookingReference)) {
    return respond(res, 400, { error: 'bookingReference must be a UUID created by the booking system.' });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workflowId)) {
    return respond(res, 503, { error: 'Ellis identity verification workflow is not configured.' });
  }

  const payload = {
    workflow_id: workflowId,
    // Do not send names, contact details, ID numbers, images, or health/intake data.
    vendor_data: `${PRACTICE_SLUG}:${bookingReference}`,
    metadata: { practice: PRACTICE_SLUG },
  };

  const callbackUrl = process.env.DIDIT_ELLIS_CALLBACK_URL?.trim();
  if (callbackUrl) {
    try {
      const parsedCallback = new URL(callbackUrl);
      if (parsedCallback.protocol !== 'https:') {
        return respond(res, 503, { error: 'Ellis verification callback must use HTTPS.' });
      }
      payload.callback = parsedCallback.toString();
      payload.callback_method = 'both';
    } catch {
      return respond(res, 503, { error: 'Ellis verification callback is invalid.' });
    }
  }

  try {
    const diditResponse = await fetch(DIDIT_CREATE_SESSION_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!diditResponse.ok) {
      // Never log or return the provider body: it may include user or account details.
      console.error('Didit session creation failed with HTTP status:', diditResponse.status);
      if (diditResponse.status === 429) {
        const retryAfter = diditResponse.headers.get('retry-after');
        if (retryAfter) res.setHeader('Retry-After', retryAfter);
        return respond(res, 503, { error: 'Verification is temporarily busy. Please try again shortly.' });
      }
      return respond(res, 502, { error: 'Could not start identity verification.' });
    }

    const session = await diditResponse.json();
    const expectedVendorData = `${PRACTICE_SLUG}:${bookingReference}`;
    if (typeof session?.session_id !== 'string'
        || !BOOKING_REFERENCE_PATTERN.test(session.session_id)
        || typeof session?.workflow_id !== 'string'
        || session.workflow_id.toLowerCase() !== workflowId.toLowerCase()
        || session.vendor_data !== expectedVendorData
        || !isAllowedHostedUrl(session?.url)) {
      console.error('Didit returned an invalid session response.');
      return respond(res, 502, { error: 'Could not start identity verification.' });
    }

    // Do not return session_token or any extracted identity data to the caller.
    return respond(res, 201, {
      sessionId: session.session_id,
      verificationUrl: session.url,
    });
  } catch {
    console.error('Didit session request failed or timed out.');
    return respond(res, 502, { error: 'Could not reach the verification service.' });
  }
}
