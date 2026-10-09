import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import handler, {
  canonicalizeDidit,
  mapDiditStatus,
  parseEllisBookingReference,
  validateEllisStatusEvent,
  verifySignatureV2,
} from '../api/ellis-didit-webhook.js';

const SECRET = 'didit-test-secret-that-is-long-enough-for-unit-tests';
const WORKFLOW = '66666666-7777-8888-9999-000000000000';
const BOOKING = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SESSION = 'cccccccc-dddd-4eee-8fff-000000000000';
const EVENT = '9c0c8b8a-1111-4222-9333-444444444444';

function envelope(overrides = {}) {
  return {
    event_id: EVENT,
    webhook_type: 'status.updated',
    timestamp: Math.floor(Date.now() / 1000),
    created_at: Math.floor(Date.now() / 1000),
    session_id: SESSION,
    status: 'Approved',
    environment: 'sandbox',
    workflow_id: WORKFLOW,
    vendor_data: `ellis-restorative-therapies:${BOOKING}`,
    decision: { id_verifications: [{ full_name: 'Jordan Demo', document_number: 'DO-NOT-STORE' }] },
    ...overrides,
  };
}

function sign(payload, secret = SECRET) {
  return createHmac('sha256', secret).update(canonicalizeDidit(payload), 'utf8').digest('hex');
}

function fakeResponse() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

test('canonical JSON sorts nested keys, is compact, and keeps Unicode unescaped', () => {
  assert.equal(canonicalizeDidit({ z: 1, nested: { b: 2, a: 'café' }, a: true }), '{"a":true,"nested":{"a":"café","b":2},"z":1}');
});

test('V2 HMAC verifies the full body and rejects an invalid or stale signature', () => {
  const now = 1_800_000_000;
  const payload = { z: 1, a: 'SomaSync' };
  const timestamp = String(now);
  const signature = sign(payload);
  assert.equal(verifySignatureV2(payload, signature, timestamp, SECRET, now), true);
  assert.equal(verifySignatureV2({ ...payload, a: 'changed' }, signature, timestamp, SECRET, now), false);
  assert.equal(verifySignatureV2(payload, signature, String(now - 301), SECRET, now), false);
  assert.equal(verifySignatureV2(payload, 'not-a-signature', timestamp, SECRET, now), false);
});

test('statuses and opaque Ellis booking references are normalized without accepting other practices', () => {
  assert.equal(mapDiditStatus('Approved'), 'approved');
  assert.equal(mapDiditStatus('Kyc Expired'), 'kyc_expired');
  assert.equal(mapDiditStatus('UNKNOWN'), null);
  assert.equal(parseEllisBookingReference(`ellis-restorative-therapies:${BOOKING}`), BOOKING);
  assert.equal(parseEllisBookingReference(`other-practice:${BOOKING}`), null);
  assert.equal(parseEllisBookingReference('ellis-restorative-therapies:Jordan'), null);
});

test('event association requires the expected workflow, environment, status and practice reference', () => {
  const valid = validateEllisStatusEvent(envelope(), WORKFLOW, 'sandbox');
  assert.equal(valid.ok, true);
  assert.equal(valid.record.bookingReference, BOOKING);
  assert.equal(valid.record.statusKey, 'approved');
  assert.equal(validateEllisStatusEvent(envelope({ workflow_id: '11111111-2222-3333-4444-555555555555' }), WORKFLOW, 'sandbox').reason, 'workflow_mismatch');
  assert.equal(validateEllisStatusEvent(envelope({ environment: 'live' }), WORKFLOW, 'sandbox').reason, 'environment_mismatch');
  assert.equal(validateEllisStatusEvent(envelope({ vendor_data: 'ellis-restorative-therapies:Jordan' }), WORKFLOW, 'sandbox').reason, 'booking_reference_mismatch');
});

test('rejects a stale signed body when only the unsigned X-Timestamp header is replaced', async (t) => {
  const envNames = [
    'DIDIT_ELLIS_WEBHOOK_SECRET', 'DIDIT_ELLIS_WORKFLOW_ID', 'DIDIT_ELLIS_ENVIRONMENT',
    'DIDIT_ELLIS_RESULT_STORE_URL', 'ELLIS_DIDIT_RESULT_STORE_TOKEN',
  ];
  const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  t.after(() => {
    envNames.forEach((name) => {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    });
    globalThis.fetch = previousFetch;
  });

  process.env.DIDIT_ELLIS_WEBHOOK_SECRET = SECRET;
  process.env.DIDIT_ELLIS_WORKFLOW_ID = WORKFLOW;
  process.env.DIDIT_ELLIS_ENVIRONMENT = 'sandbox';
  process.env.DIDIT_ELLIS_RESULT_STORE_URL = 'https://script.google.com/macros/s/AKfycbFakeTestId/exec';
  process.env.ELLIS_DIDIT_RESULT_STORE_TOKEN = 'a'.repeat(64);

  let storeCalls = 0;
  globalThis.fetch = async () => {
    storeCalls += 1;
    return new Response(JSON.stringify({ ok: true, duplicate: false }), { status: 200 });
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = envelope({ timestamp: now - 86400, created_at: now - 86400 });
  const req = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-timestamp': String(now),
      'x-signature-v2': sign(payload),
    },
    body: payload,
  };
  const res = fakeResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(storeCalls, 0);
});

test('webhook forwards only the allowlisted result fields and does not persist decision data', async (t) => {
  const envNames = [
    'DIDIT_ELLIS_WEBHOOK_SECRET', 'DIDIT_ELLIS_WORKFLOW_ID', 'DIDIT_ELLIS_ENVIRONMENT',
    'DIDIT_ELLIS_RESULT_STORE_URL', 'ELLIS_DIDIT_RESULT_STORE_TOKEN',
  ];
  const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  t.after(() => {
    envNames.forEach((name) => {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    });
    globalThis.fetch = previousFetch;
  });

  process.env.DIDIT_ELLIS_WEBHOOK_SECRET = SECRET;
  process.env.DIDIT_ELLIS_WORKFLOW_ID = WORKFLOW;
  process.env.DIDIT_ELLIS_ENVIRONMENT = 'sandbox';
  process.env.DIDIT_ELLIS_RESULT_STORE_URL = 'https://script.google.com/macros/s/AKfycbFakeTestId/exec';
  process.env.ELLIS_DIDIT_RESULT_STORE_TOKEN = 'a'.repeat(64);

  let storeRequest;
  globalThis.fetch = async (url, options) => {
    storeRequest = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ ok: true, duplicate: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const payload = envelope();
  const timestamp = String(payload.timestamp);
  const req = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-timestamp': timestamp,
      'x-signature-v2': sign(payload),
    },
    body: payload,
  };
  const res = fakeResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.received, true);
  assert.equal(storeRequest.url, process.env.DIDIT_ELLIS_RESULT_STORE_URL);
  assert.equal(storeRequest.body.outcome.bookingReference, BOOKING);
  assert.equal(storeRequest.body.outcome.statusKey, 'approved');
  assert.equal('decision' in storeRequest.body, false);
  assert.equal('decision' in storeRequest.body.outcome, false);
  assert.equal(JSON.stringify(storeRequest.body).includes('DO-NOT-STORE'), false);
});
